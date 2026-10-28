import { HttpClient, HttpErrorResponse } from '@angular/common/http';
import { inject, Injectable } from '@angular/core';
import { defer, from, Observable, switchMap, throwError } from 'rxjs';
import { AuthService } from '../auth/auth.service';

export interface CartItem {
  productId: string;
  productName: string;
  quantity: number;
  unitPrice: number;
  subTotal: number;
}

export interface CartResponse {
  id: string;
  status: 'ACTIVE' | 'CHECKED_OUT' | 'ABANDONED';
  items: CartItem[];
  totalItems: number;
  estimatedTotal: number;
  currency: string;
  updatedAt: string;
}

export interface AddedProduct {
  cartId: string;
  productId: string;
  quantity: number;
  message: string;
}

@Injectable({ providedIn: 'root' })
export class CartApi {
  private readonly http = inject(HttpClient);
  private readonly auth = inject(AuthService);

  getCart() {
    return this.authorized((token) =>
      this.http.get<CartResponse>('/api/v1/carts/me', this.options(token)),
    );
  }

  add(productId: string, quantity: number) {
    return this.authorized((token) =>
      this.http.post<AddedProduct>(
        '/api/v1/carts/me/items',
        { productId, quantity },
        this.options(token),
      ),
    );
  }

  update(productId: string, quantity: number) {
    return this.authorized((token) =>
      this.http.patch<void>(
        `/api/v1/carts/me/items/${encodeURIComponent(productId)}`,
        { quantity },
        this.options(token),
      ),
    );
  }

  remove(productId: string) {
    return this.authorized((token) =>
      this.http.delete<void>(
        `/api/v1/carts/me/items/${encodeURIComponent(productId)}`,
        this.options(token),
      ),
    );
  }

  private options(token: string) {
    return { headers: { Authorization: `Bearer ${token}` }, timeout: 10000 };
  }

  private authorized<T>(send: (token: string) => Observable<T>): Observable<T> {
    return defer(() => from(this.auth.getAccessToken())).pipe(
      switchMap((token) =>
        token ? send(token) : throwError(() => new HttpErrorResponse({ status: 401 })),
      ),
    );
  }
}
