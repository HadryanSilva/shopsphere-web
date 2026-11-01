import { HttpClient, HttpErrorResponse } from '@angular/common/http';
import { inject, Injectable } from '@angular/core';
import { defer, from, map, Observable, switchMap, throwError } from 'rxjs';
import { AuthService } from '../auth/auth.service';

export type OrderStatus =
  | 'PENDING'
  | 'COMPLETED'
  | 'PENDING_STOCK'
  | 'PENDING_PAYMENT'
  | 'CONFIRMED'
  | 'PROCESSING'
  | 'SHIPPED'
  | 'DELIVERED'
  | 'CANCELLED'
  | 'PAYMENT_FAILED';

export interface ShippingAddressRequest {
  recipient: string;
  addressLine: string;
  addressLine2: string | null;
  city: string;
  postalCode: string;
  countryCode: string;
}

export interface CreateOrderRequest {
  shippingAddress: ShippingAddressRequest;
}

export interface OrderItemResponse {
  productId: string;
  productName: string;
  quantity: number;
  unitPrice: number;
  lineTotal: number;
}

export interface OrderResponse {
  id: string;
  status: OrderStatus;
  items: OrderItemResponse[];
  subtotal: number;
  discountAmount: number;
  shippingAmount: number;
  totalAmount: number;
  currency: string;
  paymentStatus: string | null;
  updatedAt: string;
}

@Injectable({ providedIn: 'root' })
export class OrderApi {
  private readonly http = inject(HttpClient);
  private readonly auth = inject(AuthService);

  getOrder(id: string) {
    return this.authorized((token) =>
      this.http.get<OrderResponse>(`/api/v1/orders/${encodeURIComponent(id)}`, this.options(token)),
    );
  }

  createOrder(request: CreateOrderRequest, idempotencyKey: string) {
    return this.createOrderResponse(request, idempotencyKey).pipe(
      map((response) => response.body!),
    );
  }

  createOrderResponse(request: CreateOrderRequest, idempotencyKey: string) {
    const address = request.shippingAddress;
    const body: CreateOrderRequest = {
      shippingAddress: {
        recipient: address.recipient,
        addressLine: address.addressLine,
        addressLine2: address.addressLine2,
        city: address.city,
        postalCode: address.postalCode,
        countryCode: address.countryCode,
      },
    };
    return this.authorized((token) =>
      this.http.post<OrderResponse>('/api/v1/orders', body, {
        ...this.options(token),
        headers: { Authorization: `Bearer ${token}`, 'Idempotency-Key': idempotencyKey },
        observe: 'response',
      }),
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
