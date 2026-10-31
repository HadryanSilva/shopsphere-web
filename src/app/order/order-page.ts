import { CurrencyPipe, DatePipe, registerLocaleData } from '@angular/common';
import localePt from '@angular/common/locales/pt-PT';
import { HttpErrorResponse } from '@angular/common/http';
import {
  afterRenderEffect,
  Component,
  computed,
  DestroyRef,
  ElementRef,
  inject,
  LOCALE_ID,
  signal,
  viewChild,
} from '@angular/core';
import { takeUntilDestroyed, toObservable, toSignal } from '@angular/core/rxjs-interop';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { catchError, map, of, startWith, Subject, switchMap } from 'rxjs';
import { AuthService, AuthState } from '../auth/auth.service';
import { OrderApi, OrderResponse } from './order-api';

registerLocaleData(localePt, 'pt-PT');

type OrderState =
  | { status: 'sign-in' | 'loading' | 'not-found' }
  | { status: 'error'; message: string; unauthorized: boolean }
  | { status: 'loaded'; order: OrderResponse };

interface OrderContext {
  id: string;
  status: AuthState['status'];
  subject: string | undefined;
}

const uuid = /^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i;
const labels: Record<string, string> = {
  PENDING: 'Pendente',
  COMPLETED: 'Concluído',
  PENDING_STOCK: 'Pedido criado; a aguardar verificação de estoque',
  PENDING_PAYMENT: 'A aguardar pagamento; pagamento indisponível nesta fase',
  CONFIRMED: 'Pedido confirmado',
  PROCESSING: 'Em processamento',
  SHIPPED: 'Enviado',
  DELIVERED: 'Entregue',
  CANCELLED: 'Pedido cancelado',
  PAYMENT_FAILED: 'Falha no pagamento',
};

function validOrder(order: OrderResponse, id: string): boolean {
  const money = (value: unknown) =>
    typeof value === 'number' && Number.isFinite(value) && value >= 0;
  return (
    !!order &&
    typeof order.id === 'string' &&
    order.id.toLowerCase() === id.toLowerCase() &&
    typeof order.status === 'string' &&
    typeof order.currency === 'string' &&
    /^[A-Z]{3}$/.test(order.currency) &&
    typeof order.updatedAt === 'string' &&
    Number.isFinite(Date.parse(order.updatedAt)) &&
    [order.subtotal, order.discountAmount, order.shippingAmount, order.totalAmount].every(money) &&
    Array.isArray(order.items) &&
    order.items.length > 0 &&
    order.items.every(
      (item) =>
        !!item &&
        typeof item.productId === 'string' &&
        uuid.test(item.productId) &&
        typeof item.productName === 'string' &&
        !!item.productName.trim() &&
        Number.isSafeInteger(item.quantity) &&
        item.quantity > 0 &&
        money(item.unitPrice) &&
        money(item.lineTotal),
    )
  );
}

@Component({
  imports: [CurrencyPipe, DatePipe, RouterLink],
  providers: [{ provide: LOCALE_ID, useValue: 'pt-PT' }],
  templateUrl: './order-page.html',
  styleUrl: './order-page.scss',
})
export class OrderPage {
  protected readonly auth = inject(AuthService);
  private readonly api = inject(OrderApi);
  private readonly route = inject(ActivatedRoute);
  private readonly destroyRef = inject(DestroyRef);
  private readonly heading = viewChild<ElementRef<HTMLHeadingElement>>('heading');
  private readonly id = toSignal(
    this.route.paramMap.pipe(map((params) => params.get('id') ?? '')),
    {
      initialValue: this.route.snapshot.paramMap.get('id') ?? '',
    },
  );
  private readonly status = computed(() => this.auth.state().status);
  private readonly context = computed(() => ({
    id: this.id(),
    status: this.status(),
    subject: this.auth.subject(),
  }));
  private readonly result = signal<{
    context: OrderContext;
    state: OrderState;
  } | null>(null);
  private readonly reload = new Subject<void>();
  protected readonly state = computed<OrderState>(() => {
    const context = this.context();
    const result = this.result();
    if (result?.context === context) return result.state;
    return { status: context.status === 'authenticated' ? 'loading' : 'sign-in' };
  });

  constructor() {
    afterRenderEffect(() => {
      this.id();
      this.heading()?.nativeElement.focus();
    });
    toObservable(this.context)
      .pipe(
        switchMap((context) =>
          this.reload.pipe(
            startWith(undefined),
            switchMap(() => {
              if (context.status !== 'authenticated') return of<OrderState>({ status: 'sign-in' });
              if (!uuid.test(context.id)) return of<OrderState>({ status: 'not-found' });
              if (!context.subject)
                return of<OrderState>({
                  status: 'error',
                  message: 'Não foi possível verificar a conta. Entre novamente.',
                  unauthorized: true,
                });
              return this.api.getOrder(context.id).pipe(
                map((order): OrderState => {
                  if (!validOrder(order, context.id)) throw new Error('Invalid order response');
                  return { status: 'loaded', order };
                }),
                catchError((error: unknown) => {
                  const status = error instanceof HttpErrorResponse ? error.status : undefined;
                  return of<OrderState>(
                    status === 404
                      ? { status: 'not-found' }
                      : {
                          status: 'error',
                          unauthorized: status === 401,
                          message:
                            status === 401
                              ? 'A sessão não permite consultar o pedido. Entre novamente.'
                              : status === 403
                                ? 'Não tem permissão para consultar este pedido.'
                                : 'Não foi possível carregar o pedido. Tente novamente.',
                        },
                  );
                }),
                startWith<OrderState>({ status: 'loading' }),
              );
            }),
            map((state) => ({ context, state })),
          ),
        ),
        takeUntilDestroyed(this.destroyRef),
      )
      .subscribe((result) => this.result.set(result));
  }

  protected load() {
    if (this.state().status !== 'loading') this.reload.next();
  }

  protected statusLabel(status: string) {
    return Object.hasOwn(labels, status) ? labels[status] : 'Estado indisponível';
  }
}
