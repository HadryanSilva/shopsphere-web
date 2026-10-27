import { CurrencyPipe, registerLocaleData } from '@angular/common';
import { Component, DestroyRef, inject, LOCALE_ID, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import localePt from '@angular/common/locales/pt-PT';
import { CatalogApi, ProductPage } from './catalog-api';

registerLocaleData(localePt, 'pt-PT');

type CatalogState =
  { status: 'loading' } | { status: 'error' } | { status: 'loaded'; page: ProductPage };

@Component({
  selector: 'app-catalog',
  imports: [CurrencyPipe],
  providers: [{ provide: LOCALE_ID, useValue: 'pt-PT' }],
  templateUrl: './catalog.html',
  styleUrl: './catalog.scss',
})
export class Catalog {
  private readonly api = inject(CatalogApi);
  private readonly destroyRef = inject(DestroyRef);
  protected readonly state = signal<CatalogState>({ status: 'loading' });
  protected readonly failedImages = signal<ReadonlySet<string>>(new Set());

  constructor() {
    this.load();
  }

  protected load() {
    this.state.set({ status: 'loading' });
    this.api
      .listProducts()
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (page) => this.state.set({ status: 'loaded', page }),
        error: () => this.state.set({ status: 'error' }),
      });
  }

  protected imageFailed(id: string) {
    this.failedImages.update((ids) => new Set([...ids, id]));
  }
}
