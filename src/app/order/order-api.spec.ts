import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { AuthService } from '../auth/auth.service';
import { CatalogApi } from '../catalog/catalog-api';
import { CreateOrderRequest, OrderApi, OrderResponse } from './order-api';

describe('OrderApi', () => {
  let api: OrderApi;
  let http: HttpTestingController;
  const auth = { getAccessToken: vi.fn(async (): Promise<string | undefined> => 'test-token') };
  const id = '20000000-0000-0000-0000-000000000001';
  const key = '30000000-0000-0000-0000-000000000001';
  const request: CreateOrderRequest = {
    shippingAddress: {
      recipient: 'Destinatário de teste',
      addressLine: 'Rua de teste, 1',
      addressLine2: null,
      city: 'Lisboa',
      postalCode: '1000-001',
      countryCode: 'PT',
    },
  };
  const order: OrderResponse = {
    id,
    status: 'PENDING_STOCK',
    items: [
      {
        productId: '10000000-0000-0000-0000-000000000001',
        productName: 'Produto de teste',
        quantity: 2,
        unitPrice: 12.5,
        lineTotal: 25,
      },
    ],
    subtotal: 25,
    discountAmount: 0,
    shippingAmount: 0,
    totalAmount: 25,
    currency: 'EUR',
    paymentStatus: null,
    updatedAt: '2026-10-31T12:00:00Z',
  };

  beforeEach(() => {
    auth.getAccessToken.mockReset().mockResolvedValue('test-token');
    TestBed.configureTestingModule({
      providers: [
        provideHttpClient(),
        provideHttpClientTesting(),
        { provide: AuthService, useValue: auth },
      ],
    });
    api = TestBed.inject(OrderApi);
    http = TestBed.inject(HttpTestingController);
  });
  afterEach(() => http.verify());

  it('reads the order through the Gateway with a fresh token and timeout', async () => {
    const received = vi.fn();
    api.getOrder(id).subscribe(received);
    await Promise.resolve();
    const get = http.expectOne(`/api/v1/orders/${id}`);
    expect(get.request.method).toBe('GET');
    expect(get.request.body).toBeNull();
    expect(get.request.headers.get('Authorization')).toBe('Bearer test-token');
    expect(get.request.headers.has('Idempotency-Key')).toBe(false);
    expect(get.request.timeout).toBe(10000);
    get.flush(order);
    expect(received).toHaveBeenCalledWith(order);
  });

  it('encodes the order ID as a single path segment', async () => {
    api.getOrder('id/with?query#fragment').subscribe();
    await Promise.resolve();
    http.expectOne('/api/v1/orders/id%2Fwith%3Fquery%23fragment').flush(order);
  });

  it('posts only the address fields and caller-supplied idempotency key', async () => {
    const received = vi.fn();
    const extraFields = {
      ...request,
      customerId: 'untrusted',
      cartId: 'untrusted',
      items: [{ productId: 'untrusted', quantity: 10, unitPrice: 0.01 }],
      totalAmount: 0.01,
      discountAmount: 100,
      shippingAddress: { ...request.shippingAddress, customerId: 'untrusted' },
    };
    api.createOrder(extraFields, key).subscribe(received);
    await Promise.resolve();
    const post = http.expectOne('/api/v1/orders');
    expect(post.request.method).toBe('POST');
    expect(post.request.body).toEqual(request);
    expect(post.request.headers.get('Authorization')).toBe('Bearer test-token');
    expect(post.request.headers.get('Idempotency-Key')).toBe(key);
    expect(post.request.timeout).toBe(10000);
    post.flush(order, {
      status: 201,
      statusText: 'Created',
      headers: { Location: `/api/v1/orders/${id}` },
    });
    expect(received).toHaveBeenCalledWith(order);
  });

  it('does not normalize the address or generate a new key for an explicit replay', async () => {
    const original = {
      shippingAddress: { ...request.shippingAddress, recipient: ' Nome ', addressLine2: '' },
    };
    for (let attempt = 0; attempt < 2; attempt++) {
      api.createOrder(original, key).subscribe();
      await Promise.resolve();
      const post = http.expectOne('/api/v1/orders');
      expect(post.request.body).toEqual(original);
      expect(post.request.headers.get('Idempotency-Key')).toBe(key);
      post.flush(order, { status: 201, statusText: 'Created' });
    }
    expect(auth.getAccessToken).toHaveBeenCalledTimes(2);
  });

  it('gets a new token per subscription and keeps public Catalog requests unauthenticated', async () => {
    auth.getAccessToken.mockResolvedValueOnce('first-token').mockResolvedValueOnce('next-token');
    const read = api.getOrder(id);
    expect(auth.getAccessToken).not.toHaveBeenCalled();
    for (const token of ['first-token', 'next-token']) {
      read.subscribe();
      await Promise.resolve();
      const get = http.expectOne(`/api/v1/orders/${id}`);
      expect(get.request.headers.get('Authorization')).toBe(`Bearer ${token}`);
      get.flush(order);
    }
    TestBed.inject(CatalogApi).getProduct('product').subscribe();
    const publicRead = http.expectOne('/api/v1/products/product');
    expect(publicRead.request.headers.has('Authorization')).toBe(false);
    publicRead.flush({});
    expect(auth.getAccessToken).toHaveBeenCalledTimes(2);
  });

  it.each(['read', 'create'])(
    'fails locally with 401 without a token for %s',
    async (operation) => {
      auth.getAccessToken.mockResolvedValue(undefined);
      const error = vi.fn();
      const result = operation === 'read' ? api.getOrder(id) : api.createOrder(request, key);
      result.subscribe({ error });
      await Promise.resolve();
      expect(error).toHaveBeenCalledWith(expect.objectContaining({ status: 401 }));
      http.expectNone((req) => req.url.startsWith('/api/v1/orders'));
    },
  );

  it.each([400, 401, 403, 404, 409, 502, 503])(
    'propagates POST %s without automatic retry',
    async (status) => {
      const error = vi.fn();
      api.createOrder(request, key).subscribe({ error });
      await Promise.resolve();
      http
        .expectOne('/api/v1/orders')
        .flush({ detail: 'test failure' }, { status, statusText: 'Failure' });
      await Promise.resolve();
      expect(error).toHaveBeenCalledOnce();
      expect(error).toHaveBeenCalledWith(expect.objectContaining({ status }));
      expect(auth.getAccessToken).toHaveBeenCalledTimes(1);
      http.expectNone('/api/v1/orders');
    },
  );

  it('propagates a lost connection without replaying the POST', async () => {
    const error = vi.fn();
    api.createOrder(request, key).subscribe({ error });
    await Promise.resolve();
    http.expectOne('/api/v1/orders').error(new ProgressEvent('error'));
    await Promise.resolve();
    expect(error).toHaveBeenCalledWith(expect.objectContaining({ status: 0 }));
    http.expectNone('/api/v1/orders');
  });

  it('does not send a request after unsubscribing while waiting for the token', async () => {
    let release!: (token: string) => void;
    auth.getAccessToken.mockReturnValue(
      new Promise((resolve) => {
        release = resolve;
      }),
    );
    const subscription = api.createOrder(request, key).subscribe();
    subscription.unsubscribe();
    release('late-token');
    await Promise.resolve();
    http.expectNone('/api/v1/orders');
  });
});
