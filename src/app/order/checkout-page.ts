import { CurrencyPipe, registerLocaleData } from '@angular/common';
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
import { takeUntilDestroyed, toObservable } from '@angular/core/rxjs-interop';
import { RouterLink } from '@angular/router';
import { catchError, map, of, startWith, Subject, switchMap } from 'rxjs';
import { AuthService } from '../auth/auth.service';
import { CartApi, CartResponse } from '../cart/cart-api';
import { cartError, isMissingCart } from '../cart/cart-errors';
import { ShippingAddressForm } from './shipping-address-form';

registerLocaleData(localePt, 'pt-PT');

type CheckoutPreviewState =
  | { status: 'sign-in' | 'loading' | 'empty' }
  | { status: 'blocked'; message: string }
  | { status: 'error'; message: string; unauthorized: boolean }
  | { status: 'loaded'; cart: CartResponse };

function validCart(cart: CartResponse): boolean {
  const money = (value: unknown) =>
    typeof value === 'number' && Number.isFinite(value) && value >= 0;
  const uuid = /^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i;
  return (
    !!cart &&
    ['ACTIVE', 'CHECKED_OUT', 'ABANDONED'].includes(cart.status) &&
    typeof cart.currency === 'string' &&
    /^[A-Z]{3}$/.test(cart.currency) &&
    money(cart.estimatedTotal) &&
    Number.isSafeInteger(cart.totalItems) &&
    cart.totalItems >= 0 &&
    Array.isArray(cart.items) &&
    cart.items.every(
      (item) =>
        !!item &&
        typeof item.productId === 'string' &&
        uuid.test(item.productId) &&
        typeof item.productName === 'string' &&
        !!item.productName.trim() &&
        Number.isSafeInteger(item.quantity) &&
        item.quantity > 0 &&
        money(item.unitPrice) &&
        money(item.subTotal),
    ) &&
    new Set(cart.items.map((item) => item.productId.toLowerCase())).size === cart.items.length
  );
}

@Component({
  imports: [CurrencyPipe, RouterLink, ShippingAddressForm],
  providers: [{ provide: LOCALE_ID, useValue: 'pt-PT' }],
  templateUrl: './checkout-page.html',
  styleUrl: './checkout-page.scss',
})
export class CheckoutPage {
  protected readonly auth = inject(AuthService);
  private readonly api = inject(CartApi);
  private readonly destroy = inject(DestroyRef);
  private readonly heading = viewChild<ElementRef<HTMLHeadingElement>>('heading');
  private readonly status = computed(() => this.auth.state().status);
  private readonly context = computed(() => ({
    status: this.status(),
    subject: this.auth.subject(),
  }));
  private readonly result = signal<{
    context: { status: string; subject: string | undefined };
    state: CheckoutPreviewState;
  } | null>(null);
  private readonly reload = new Subject<void>();
  protected readonly state = computed<CheckoutPreviewState>(() => {
    const context = this.context();
    const result = this.result();
    return result?.context === context
      ? result.state
      : { status: context.status === 'authenticated' ? 'loading' : 'sign-in' };
  });

  constructor() {
    afterRenderEffect(() => this.heading()?.nativeElement.focus());
    toObservable(this.context)
      .pipe(
        switchMap((context) =>
          this.reload.pipe(
            startWith(undefined),
            switchMap(() => {
              if (context.status !== 'authenticated')
                return of<CheckoutPreviewState>({ status: 'sign-in' });
              if (!context.subject)
                return of<CheckoutPreviewState>({
                  status: 'error',
                  unauthorized: true,
                  message: 'Não foi possível verificar a conta. Entre novamente.',
                });
              return this.api.getCart().pipe(
                map((cart): CheckoutPreviewState => {
                  if (!validCart(cart)) throw new Error('Invalid cart response');
                  if (cart.status !== 'ACTIVE')
                    return {
                      status: 'blocked',
                      message:
                        'Este carrinho já não está ativo. Consulte o carrinho antes de continuar.',
                    };
                  if (!cart.items.length) return { status: 'empty' };
                  if (cart.items.length > 100)
                    return {
                      status: 'blocked',
                      message:
                        'O checkout permite até 100 produtos diferentes. Ajuste o carrinho antes de continuar.',
                    };
                  return { status: 'loaded', cart };
                }),
                catchError((error) =>
                  of<CheckoutPreviewState>(
                    isMissingCart(error)
                      ? { status: 'empty' }
                      : {
                          status: 'error',
                          message: cartError(error),
                          unauthorized: error instanceof HttpErrorResponse && error.status === 401,
                        },
                  ),
                ),
                startWith<CheckoutPreviewState>({ status: 'loading' }),
              );
            }),
            map((state) => ({ context, state })),
          ),
        ),
        takeUntilDestroyed(this.destroy),
      )
      .subscribe((result) => this.result.set(result));
  }

  protected load() {
    if (this.state().status !== 'loading') this.reload.next();
  }
}
