import { CurrencyPipe, registerLocaleData } from '@angular/common';
import localePt from '@angular/common/locales/pt-PT';
import { Component, computed, DestroyRef, inject, LOCALE_ID, signal } from '@angular/core';
import { takeUntilDestroyed, toObservable } from '@angular/core/rxjs-interop';
import { HttpErrorResponse } from '@angular/common/http';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import {
  catchError,
  distinctUntilChanged,
  map,
  of,
  startWith,
  Subject,
  switchMap,
  tap,
  filter,
  finalize,
  Subscription,
  takeUntil,
} from 'rxjs';
import { CatalogApi, Product } from '../catalog/catalog-api';
import { AuthService } from '../auth/auth.service';
import { CartApi } from '../cart/cart-api';
import { cartError } from '../cart/cart-errors';

registerLocaleData(localePt, 'pt-PT');

type DetailState =
  | { status: 'loading' }
  | { status: 'not-found' }
  | { status: 'error' }
  | { status: 'loaded'; product: Product };

@Component({
  imports: [CurrencyPipe, RouterLink],
  providers: [{ provide: LOCALE_ID, useValue: 'pt-PT' }],
  templateUrl: './product-detail.html',
  styleUrl: './product-detail.scss',
})
export class ProductDetail {
  protected readonly auth = inject(AuthService);
  private readonly cartApi = inject(CartApi);
  private readonly router = inject(Router);
  private readonly sessionStatus = computed(() => this.auth.state().status);
  private readonly sessionChanges = toObservable(this.sessionStatus);
  private addSubscription?: Subscription;
  private readonly api = inject(CatalogApi);
  private readonly route = inject(ActivatedRoute);
  private readonly destroyRef = inject(DestroyRef);
  private readonly retry = new Subject<void>();
  protected readonly state = signal<DetailState>({ status: 'loading' });
  protected readonly imageFailed = signal(false);
  protected readonly quantity = signal('1');
  protected readonly adding = signal(false);
  protected readonly added = signal(false);
  protected readonly addError = signal('');
  protected readonly addUnauthorized = signal(false);
  protected readonly needsCartCheck = signal(false);
  protected readonly quantityError = computed(() => {
    const quantity = this.quantity();
    return !/^\d+$/.test(quantity) || Number(quantity) < 1 || Number(quantity) > 2147483647;
  });

  constructor() {
    this.sessionChanges
      .pipe(
        filter((status) => status !== 'authenticated'),
        takeUntilDestroyed(this.destroyRef),
      )
      .subscribe(() => {
        this.added.set(false);
        this.addError.set('');
        this.addUnauthorized.set(false);
        this.needsCartCheck.set(false);
      });
    this.route.paramMap
      .pipe(
        map((params) => params.get('id') ?? ''),
        distinctUntilChanged(),
        tap(() => {
          this.addSubscription?.unsubscribe();
          this.added.set(false);
          this.addError.set('');
          this.needsCartCheck.set(false);
          this.addUnauthorized.set(false);
          this.imageFailed.set(false);
          const quantity = this.route.snapshot.queryParamMap.get('quantity') ?? '1';
          this.quantity.set(
            /^\d+$/.test(quantity) && Number(quantity) >= 1 && Number(quantity) <= 2147483647
              ? quantity
              : '1',
          );
        }),
        switchMap((id) =>
          this.retry.pipe(
            startWith(undefined),
            switchMap(() => {
              if (!/^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(id)) {
                return of<DetailState>({ status: 'not-found' });
              }
              return this.api.getProduct(id).pipe(
                map((product): DetailState => ({ status: 'loaded', product })),
                catchError((error: HttpErrorResponse) =>
                  of<DetailState>({ status: error.status === 404 ? 'not-found' : 'error' }),
                ),
                startWith<DetailState>({ status: 'loading' }),
              );
            }),
          ),
        ),
        takeUntilDestroyed(this.destroyRef),
      )
      .subscribe((state) => this.state.set(state));
  }

  protected load() {
    this.retry.next();
  }

  protected async loginToAdd(force = false) {
    if (this.quantityError()) return;
    await this.router.navigate([], {
      relativeTo: this.route,
      queryParams: { quantity: this.quantity() },
      queryParamsHandling: 'merge',
      preserveFragment: true,
      replaceUrl: true,
    });
    await this.auth.login(force);
  }

  protected addToCart() {
    const current = this.state();
    if (
      this.adding() ||
      this.needsCartCheck() ||
      this.quantityError() ||
      this.auth.state().status !== 'authenticated' ||
      current.status !== 'loaded' ||
      current.product.status !== 'ACTIVE'
    )
      return;
    this.adding.set(true);
    this.added.set(false);
    this.addError.set('');
    this.addUnauthorized.set(false);
    this.addSubscription = this.cartApi
      .add(current.product.id, Number(this.quantity()))
      .pipe(
        takeUntil(this.sessionChanges.pipe(filter((status) => status !== 'authenticated'))),
        takeUntilDestroyed(this.destroyRef),
        finalize(() => this.adding.set(false)),
      )
      .subscribe({
        next: () => this.added.set(true),
        error: (error) => {
          this.addError.set(cartError(error, true));
          this.needsCartCheck.set(true);
          this.addUnauthorized.set(error instanceof HttpErrorResponse && error.status === 401);
        },
      });
  }
}
