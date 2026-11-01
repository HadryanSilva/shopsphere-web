import { HttpErrorResponse, HttpResponse } from '@angular/common/http';
import { computed, DestroyRef, effect, inject, Injectable, signal, untracked } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { Observable, Subscription, take, timeout } from 'rxjs';
import { AuthService } from '../auth/auth.service';
import {
  CheckoutIntent,
  CheckoutIntentError,
  CheckoutIntentStore,
  PendingCheckoutIntent,
} from './checkout-intent-store';
import { OrderApi, OrderResponse, ShippingAddressRequest } from './order-api';
import { isOrderResponse } from './order-response';

export type CheckoutState =
  | { status: 'sign-in' | 'idle' | 'sending' | 'checking' }
  | { status: 'pending'; intent: PendingCheckoutIntent }
  | { status: 'known'; orderId: string }
  | { status: 'success'; order: OrderResponse; persisted: boolean }
  | {
      status: 'error';
      message: string;
      unauthorized: boolean;
      uncertain: boolean;
      orderId?: string;
    };

interface Operation {
  subject: string;
  key: string;
  kind: 'create' | 'read';
  orderId?: string;
  subscription: Subscription;
}

@Injectable({ providedIn: 'root' })
export class CheckoutCoordinator {
  private readonly auth = inject(AuthService);
  private readonly store = inject(CheckoutIntentStore);
  private readonly api = inject(OrderApi);
  private readonly session = computed(() =>
    this.auth.state().status === 'authenticated' ? this.auth.subject() : undefined,
  );
  private observedSubject?: string;
  private active?: Operation;
  private known?: { subject: string; key: string; orderId: string };
  private readonly result = signal<{ subject: string; state: CheckoutState } | null>(null);
  readonly state = computed<CheckoutState>(() => {
    const subject = this.session();
    if (!subject) return { status: 'sign-in' };
    const result = this.result();
    return result?.subject === subject ? result.state : { status: 'idle' };
  });

  constructor() {
    const destroy = inject(DestroyRef);
    this.auth.explicitLogout.pipe(takeUntilDestroyed(destroy)).subscribe(() => {
      this.stop();
      this.known = undefined;
      this.result.set(null);
    });
    effect(() => {
      const subject = this.session();
      untracked(() => {
        if (subject !== this.observedSubject) {
          this.syncSession();
          this.restore();
        }
      });
    });
    destroy.onDestroy(() => this.stop());
  }

  /** Reads local state only. Construction, login and restore never send HTTP. */
  restore(): void {
    const subject = this.syncSession();
    if (!subject || this.active) return;
    try {
      const intent = this.store.read();
      if (this.known?.subject === subject)
        this.set(subject, { status: 'known', orderId: this.known.orderId });
      else if (!intent) this.set(subject, { status: 'idle' });
      else if (intent.request) this.set(subject, { status: 'pending', intent });
      else this.set(subject, { status: 'known', orderId: intent.orderId });
    } catch (error) {
      this.localError(subject, error);
    }
  }

  /** Call only after explicit confirmation of a new purchase intention. */
  submit(address: ShippingAddressRequest): void {
    const subject = this.syncSession();
    if (!subject || this.active || this.auth.actionPending()) return;
    try {
      const intent = this.store.begin(address);
      this.known = undefined;
      this.send(intent);
    } catch (error) {
      this.localError(subject, error);
    }
  }

  /** Explicitly reconciles a stored attempt; a known ID always uses GET. */
  recover(): void {
    const subject = this.syncSession();
    if (!subject || this.active || this.auth.actionPending()) return;
    try {
      const intent: CheckoutIntent | null =
        this.known?.subject === subject
          ? { version: 1, subject, idempotencyKey: this.known.key, orderId: this.known.orderId }
          : this.store.read();
      if (!intent) {
        this.set(subject, {
          status: 'error',
          message: 'Não existe uma tentativa guardada para verificar.',
          unauthorized: false,
          uncertain: false,
        });
      } else if (intent.request) this.send(intent);
      else this.start(intent, 'read', this.api.getOrder(intent.orderId));
    } catch (error) {
      this.localError(subject, error);
    }
  }

  /** Used when leaving the checkout. Cancellation does not imply server rollback. */
  cancel(): void {
    const operation = this.active;
    if (!operation) return;
    this.stop();
    if (this.session() === operation.subject) {
      this.set(operation.subject, {
        status: 'error',
        message:
          'A consulta ou o envio foi interrompido. Verifique a tentativa antes de continuar.',
        unauthorized: false,
        uncertain: operation.kind === 'create',
        orderId: operation.orderId,
      });
    }
  }

  private send(intent: PendingCheckoutIntent) {
    this.start(
      intent,
      'create',
      this.api.createOrderResponse(intent.request, intent.idempotencyKey),
    );
  }

  private start(
    intent: CheckoutIntent,
    kind: Operation['kind'],
    request: Observable<OrderResponse | HttpResponse<OrderResponse>>,
  ) {
    const operation: Operation = {
      subject: intent.subject,
      key: intent.idempotencyKey,
      kind,
      orderId: intent.orderId,
      subscription: new Subscription(),
    };
    this.active = operation;
    this.set(operation.subject, { status: kind === 'create' ? 'sending' : 'checking' });
    operation.subscription.add(
      request.pipe(timeout(10000), take(1)).subscribe({
        next: (response) => {
          if (!this.current(operation)) return;
          const order =
            kind === 'create' && response instanceof HttpResponse ? response.body : response;
          if (
            (kind === 'create' &&
              (!(response instanceof HttpResponse) || response.status !== 201)) ||
            !isOrderResponse(order, operation.orderId)
          ) {
            this.fail(operation, undefined);
            return;
          }
          this.known = { subject: operation.subject, key: operation.key, orderId: order.id };
          let persisted = true;
          try {
            this.store.recordOrder(operation.key, order.id);
          } catch {
            persisted = false;
          }
          this.set(operation.subject, { status: 'success', order, persisted });
          this.active = undefined;
        },
        error: (error) => {
          if (this.current(operation)) this.fail(operation, error);
        },
        complete: () => {
          if (this.current(operation)) this.fail(operation, undefined);
        },
      }),
    );
  }

  private current(operation: Operation): boolean {
    return this.active === operation && this.session() === operation.subject;
  }

  private fail(operation: Operation, error: unknown) {
    this.active = undefined;
    const status = error instanceof HttpErrorResponse ? error.status : undefined;
    const message =
      status === 401
        ? 'A sessão terminou ou foi recusada. Entre novamente para verificar a tentativa.'
        : status === 403
          ? 'Não tem permissão para concluir esta operação.'
          : status === 400
            ? 'Verifique os dados do endereço. A tentativa guardada foi preservada.'
            : status === 409
              ? 'O checkout está em conflito. A tentativa guardada foi preservada; verifique o carrinho.'
              : status === 404
                ? operation.kind === 'create'
                  ? 'Não foi possível obter o carrinho necessário. A tentativa foi preservada.'
                  : 'Pedido não encontrado. Verifique a conta e tente novamente.'
                : 'Não foi possível confirmar o resultado. Verifique a tentativa antes de continuar.';
    this.set(operation.subject, {
      status: 'error',
      message,
      unauthorized: status === 401,
      uncertain: operation.kind === 'create',
      orderId: operation.orderId,
    });
  }

  private localError(subject: string, error: unknown) {
    const code = error instanceof CheckoutIntentError ? error.code : undefined;
    this.set(subject, {
      status: 'error',
      unauthorized: code === 'session',
      uncertain: code !== 'invalid-address' && code !== 'session',
      orderId: this.known?.subject === subject ? this.known.orderId : undefined,
      message:
        code === 'pending'
          ? 'Já existe uma tentativa pendente. Verifique-a antes de criar outro pedido.'
          : code === 'invalid-address'
            ? 'Verifique os dados do endereço antes de criar o pedido.'
            : 'Não foi possível guardar ou recuperar a tentativa. Tente novamente sem iniciar outra compra.',
    });
  }

  private syncSession(): string | undefined {
    const subject = this.session();
    if (subject !== this.observedSubject) {
      this.stop();
      if (subject && this.known?.subject !== subject) this.known = undefined;
      this.result.set(null);
      this.observedSubject = subject;
    }
    return subject;
  }

  private set(subject: string, state: CheckoutState) {
    this.result.set({ subject, state });
  }
  private stop() {
    const active = this.active;
    this.active = undefined;
    active?.subscription.unsubscribe();
  }
}
