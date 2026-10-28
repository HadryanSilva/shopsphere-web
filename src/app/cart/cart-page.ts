import { CurrencyPipe, registerLocaleData } from '@angular/common';
import localePt from '@angular/common/locales/pt-PT';
import { Component, computed, DestroyRef, inject, LOCALE_ID, signal } from '@angular/core';
import { takeUntilDestroyed, toObservable } from '@angular/core/rxjs-interop';
import { RouterLink } from '@angular/router';
import { HttpErrorResponse } from '@angular/common/http';
import {
  catchError,
  filter,
  finalize,
  map,
  Observable,
  of,
  startWith,
  Subject,
  switchMap,
  takeUntil,
} from 'rxjs';
import { AuthService } from '../auth/auth.service';
import { CartApi, CartResponse } from './cart-api';
import { cartError, isMissingCart } from './cart-errors';

registerLocaleData(localePt, 'pt-PT');

type CartState =
  | { status: 'sign-in' | 'loading' | 'empty' }
  | { status: 'error'; message: string; unauthorized: boolean }
  | { status: 'loaded'; cart: CartResponse };

@Component({
  imports: [CurrencyPipe, RouterLink],
  providers: [{ provide: LOCALE_ID, useValue: 'pt-PT' }],
  templateUrl: './cart-page.html',
  styleUrl: './cart-page.scss',
})
export class CartPage {
  protected readonly auth = inject(AuthService);
  private readonly api = inject(CartApi);
  private readonly destroyRef = inject(DestroyRef);
  private readonly reload = new Subject<void>();
  private readonly sessionStatus = computed(() => this.auth.state().status);
  private readonly sessionChanges = toObservable(this.sessionStatus);
  protected readonly state = signal<CartState>({ status: 'sign-in' });
  protected readonly busy = signal(false);
  protected readonly needsReload = signal(false);
  protected readonly operationError = signal('');
  protected readonly operationUnauthorized = signal(false);
  protected readonly invalidQuantityProduct = signal<string | null>(null);

  constructor() {
    this.sessionChanges
      .pipe(
        switchMap((status) => {
          this.operationError.set('');
          this.invalidQuantityProduct.set(null);
          this.needsReload.set(false);
          this.operationUnauthorized.set(false);
          if (status !== 'authenticated') return of<CartState>({ status: 'sign-in' });
          return this.reload.pipe(
            startWith(undefined),
            switchMap(() =>
              this.api.getCart().pipe(
                map((cart): CartState => ({ status: 'loaded', cart })),
                catchError((error) =>
                  of<CartState>(
                    isMissingCart(error)
                      ? { status: 'empty' }
                      : {
                          status: 'error',
                          message: cartError(error),
                          unauthorized: error instanceof HttpErrorResponse && error.status === 401,
                        },
                  ),
                ),
                startWith<CartState>({ status: 'loading' }),
              ),
            ),
          );
        }),
        takeUntilDestroyed(this.destroyRef),
      )
      .subscribe((state) => {
        if (state.status === 'loaded' || state.status === 'empty') this.needsReload.set(false);
        this.state.set(state);
      });
  }

  protected load() {
    if (this.busy()) return;
    this.invalidQuantityProduct.set(null);
    this.operationError.set('');
    this.operationUnauthorized.set(false);
    this.reload.next();
  }

  protected update(productId: string, quantity: string, event: Event) {
    event.preventDefault();
    if (!/^\d+$/.test(quantity) || Number(quantity) < 1 || Number(quantity) > 2147483647) {
      this.invalidQuantityProduct.set(productId);
      return;
    }
    this.invalidQuantityProduct.set(null);
    this.mutate(this.api.update(productId, Number(quantity)));
  }

  protected clearQuantityError(productId: string) {
    if (this.invalidQuantityProduct() === productId) this.invalidQuantityProduct.set(null);
  }

  protected remove(productId: string) {
    this.mutate(this.api.remove(productId));
  }

  private mutate(request: Observable<void>) {
    const current = this.state();
    if (
      this.busy() ||
      this.needsReload() ||
      current.status !== 'loaded' ||
      current.cart.status !== 'ACTIVE'
    )
      return;
    this.busy.set(true);
    this.operationError.set('');
    this.operationUnauthorized.set(false);
    request
      .pipe(
        takeUntil(this.sessionChanges.pipe(filter((status) => status !== 'authenticated'))),
        takeUntilDestroyed(this.destroyRef),
        finalize(() => this.busy.set(false)),
      )
      .subscribe({
        next: () => this.reload.next(),
        error: (error) => {
          this.operationError.set(cartError(error, true));
          this.needsReload.set(true);
          this.operationUnauthorized.set(
            error instanceof HttpErrorResponse && error.status === 401,
          );
        },
      });
  }
}
