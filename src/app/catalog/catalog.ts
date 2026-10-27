import { CurrencyPipe, registerLocaleData } from '@angular/common';
import { Component, DestroyRef, inject, LOCALE_ID, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import localePt from '@angular/common/locales/pt-PT';
import { CatalogApi, ProductPage } from './catalog-api';
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
} from 'rxjs';
import { priceRangeError, readCatalogQuery, sortOptions } from './catalog-query';

registerLocaleData(localePt, 'pt-PT');

type CatalogState =
  | { status: 'loading' }
  | { status: 'error' }
  | { status: 'invalid'; message: string }
  | { status: 'loaded'; page: ProductPage };

@Component({
  selector: 'app-catalog',
  imports: [CurrencyPipe, RouterLink],
  providers: [{ provide: LOCALE_ID, useValue: 'pt-PT' }],
  templateUrl: './catalog.html',
  styleUrl: './catalog.scss',
})
export class Catalog {
  private readonly api = inject(CatalogApi);
  private readonly destroyRef = inject(DestroyRef);
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly retry = new Subject<void>();
  protected readonly state = signal<CatalogState>({ status: 'loading' });
  protected readonly failedImages = signal<ReadonlySet<string>>(new Set());
  protected readonly query = signal(readCatalogQuery(this.route.snapshot.queryParamMap));
  protected readonly filtersOpen = signal(false);
  protected readonly formError = signal('');
  protected readonly sortOptions = sortOptions;
  protected minPrice = '';
  protected maxPrice = '';

  constructor() {
    this.route.queryParamMap
      .pipe(
        map(readCatalogQuery),
        distinctUntilChanged(
          (previous, current) => JSON.stringify(previous) === JSON.stringify(current),
        ),
        tap((query) => {
          this.query.set(query);
          this.minPrice = query.minPrice;
          this.maxPrice = query.maxPrice;
          this.formError.set('');
          this.failedImages.set(new Set());
        }),
        switchMap((query) =>
          this.retry.pipe(
            startWith(undefined),
            switchMap(() => {
              const message = priceRangeError(query.minPrice, query.maxPrice);
              if (message) return of<CatalogState>({ status: 'invalid', message });
              return this.api.listProducts(query).pipe(
                map((page): CatalogState => ({ status: 'loaded', page })),
                catchError(() => of<CatalogState>({ status: 'error' })),
                startWith<CatalogState>({ status: 'loading' }),
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

  protected applyPrices(event: Event) {
    event.preventDefault();
    const min = this.minPrice.trim().replace(',', '.');
    const max = this.maxPrice.trim().replace(',', '.');
    const error = priceRangeError(min, max);
    this.formError.set(error);
    if (error) return;
    this.updateQuery({ minPrice: min || null, maxPrice: max || null, page: null });
  }

  protected updateQuery(params: Record<string, string | number | null>) {
    void this.router.navigate([], {
      relativeTo: this.route,
      queryParams: params,
      queryParamsHandling: 'merge',
      fragment: 'catalogo',
    });
  }

  protected clearFilters() {
    this.minPrice = '';
    this.maxPrice = '';
    this.formError.set('');
    this.updateQuery({ name: null, minPrice: null, maxPrice: null, page: null });
  }

  protected imageFailed(id: string) {
    this.failedImages.update((ids) => new Set([...ids, id]));
  }
}
