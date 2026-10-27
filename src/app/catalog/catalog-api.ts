import { HttpClient } from '@angular/common/http';
import { inject, Injectable } from '@angular/core';

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

  listProducts() {
    return this.http.get<ProductPage>('/api/v1/products', {
      params: { page: 0, size: 20, sort: 'name,asc', status: 'ACTIVE' },
      timeout: 10000,
    });
  }
}
