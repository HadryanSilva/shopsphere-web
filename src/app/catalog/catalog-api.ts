import { HttpClient } from '@angular/common/http';
import { inject, Injectable } from '@angular/core';
import { CatalogQuery } from './catalog-query';

export interface Product {
  id: string;
  name: string;
  description: string | null;
  categoryId: string;
  price: number;
  currency: string;
  imageUrl: string | null;
  status: 'ACTIVE' | 'INACTIVE' | 'OUT_OF_STOCK';
  createdAt: string;
  updatedAt: string;
}

export interface ProductPage {
  content: Product[];
  page: number;
  size: number;
  totalElements: number;
  totalPages: number;
  first: boolean;
  last: boolean;
}

@Injectable({ providedIn: 'root' })
export class CatalogApi {
  private readonly http = inject(HttpClient);

  getProduct(id: string) {
    return this.http.get<Product>(`/api/v1/products/${encodeURIComponent(id)}`, { timeout: 10000 });
  }

  listProducts(query: CatalogQuery) {
    const params: Record<string, string | number> = {
      page: query.page,
      size: 20,
      sort: query.sort,
      status: 'ACTIVE',
    };
    if (query.name) params['name'] = query.name;
    if (query.minPrice) params['minPrice'] = query.minPrice;
    if (query.maxPrice) params['maxPrice'] = query.maxPrice;
    return this.http.get<ProductPage>('/api/v1/products', {
      params,
      timeout: 10000,
    });
  }
}
