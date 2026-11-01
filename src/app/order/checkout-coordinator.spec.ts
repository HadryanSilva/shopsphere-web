import { DOCUMENT } from '@angular/common';
import { HttpResponse, provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { computed, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { NEVER, of, Subject } from 'rxjs';
import { AuthService, AuthState } from '../auth/auth.service';
import { CheckoutCoordinator } from './checkout-coordinator';
import { CheckoutIntentStore } from './checkout-intent-store';
import { OrderApi, OrderResponse, ShippingAddressRequest } from './order-api';

const storageKey = 'shopsphere.checkout-intent';
const key = '30000000-0000-4000-8000-000000000001';
const orderId = '20000000-0000-0000-0000-000000000001';
const productId = '20000000-0000-0000-0000-000000000002';
const address: ShippingAddressRequest = {
  recipient: ' Teste ',
  addressLine: ' Rua, 1 ',
  addressLine2: '',
  city: ' Lisboa ',
  postalCode: ' 1000-001 ',
  countryCode: ' pt ',
};
const order: OrderResponse = {
  id: orderId,
  status: 'PENDING_STOCK',
  items: [{ productId, productName: 'Livro', quantity: 2, unitPrice: 12.5, lineTotal: 25 }],
  subtotal: 25,
  discountAmount: 0,
  shippingAmount: 0,
  totalAmount: 25,
  currency: 'EUR',
  paymentStatus: null,
  updatedAt: '2026-11-01T12:00:00Z',
};

describe('CheckoutCoordinator', () => {
  const account = signal<string | undefined>('account-one');
  const explicitLogout = new Subject<void>();
  const auth = {
    state: signal<AuthState>({ status: 'authenticated', username: 'Cliente' }),
    subject: computed((): string | undefined =>
      auth.state().status === 'authenticated' ? account() : undefined,
    ),
    explicitLogout: explicitLogout.asObservable(),
    actionPending: signal(false),
    getAccessToken: vi.fn(async (): Promise<string | undefined> => 'test-token'),
  };
  let coordinator: CheckoutCoordinator;
  let store: CheckoutIntentStore;
  let http: HttpTestingController;
  let entries: Map<string, string>;
  let storage: Storage;
  let uuid: ReturnType<typeof vi.spyOn>;

  function setup() {
    TestBed.configureTestingModule({
      providers: [
        provideHttpClient(),
        provideHttpClientTesting(),
        { provide: AuthService, useValue: auth },
      ],
    });
    const window = TestBed.inject(DOCUMENT).defaultView!;
    vi.spyOn(window, 'sessionStorage', 'get').mockReturnValue(storage);
    uuid = vi.spyOn(window.crypto, 'randomUUID').mockReturnValue(key);
    store = TestBed.inject(CheckoutIntentStore);
    coordinator = TestBed.inject(CheckoutCoordinator);
    http = TestBed.inject(HttpTestingController);
  }
  beforeEach(() => {
    account.set('account-one');
    auth.state.set({ status: 'authenticated', username: 'Cliente' });
    auth.actionPending.set(false);
    auth.getAccessToken.mockReset().mockResolvedValue('test-token');
    entries = new Map();
    storage = {
      getItem: vi.fn((key: string) => entries.get(key) ?? null),
      setItem: vi.fn((key: string, value: string) => {
        entries.set(key, value);
      }),
      removeItem: vi.fn((key: string) => {
        entries.delete(key);
      }),
      clear: vi.fn(() => entries.clear()),
      key: vi.fn(() => null),
      get length() {
        return entries.size;
      },
    };
    setup();
  });
  afterEach(() => {
    http.verify();
    TestBed.resetTestingModule();
    vi.restoreAllMocks();
    vi.useRealTimers();
  });
  async function settle() {
    TestBed.tick();
    await Promise.resolve();
    TestBed.tick();
  }
  async function submit() {
    coordinator.submit(address);
    await settle();
    return http.expectOne('/api/v1/orders');
  }
  function stored() {
    return JSON.parse(entries.get(storageKey)!);
  }
  function stateError() {
    const state = coordinator.state();
    expect(state.status).toBe('error');
    if (state.status !== 'error') throw new Error('Expected error');
    return state;
  }

  it('stores before POST and validates a 201 before recording the order', async () => {
    const pending = await submit();
    expect(stored().request.shippingAddress.recipient).toBe('Teste');
    expect(pending.request.body).toEqual(stored().request);
    expect(pending.request.headers.get('Idempotency-Key')).toBe(key);
    expect(pending.request.headers.get('Authorization')).toBe('Bearer test-token');
    expect(coordinator.state().status).toBe('sending');
    pending.flush(order, {
      status: 201,
      statusText: 'Created',
      headers: { Location: 'https://example.invalid' },
    });
    expect(coordinator.state()).toEqual({ status: 'success', order, persisted: true });
    expect(stored()).toEqual({ version: 1, subject: 'account-one', idempotencyKey: key, orderId });
    expect(entries.get(storageKey)).not.toContain('shippingAddress');
    http.expectNone((request) => request.method !== 'POST');
  });

  it('does not send on construction, restore, login, refresh or recreating the service', async () => {
    auth.state.set({ status: 'anonymous' });
    await settle();
    coordinator.restore();
    expect(coordinator.state().status).toBe('sign-in');
    auth.state.set({ status: 'authenticated', username: 'Cliente' });
    await settle();
    const intent = store.begin(address);
    coordinator.restore();
    expect(coordinator.state()).toEqual({ status: 'pending', intent });
    auth.state.set({ status: 'authenticated', username: 'Outro nome' });
    await settle();
    http.expectNone((request) => request.url.startsWith('/api/'));
    http.verify();
    TestBed.resetTestingModule();
    vi.restoreAllMocks();
    setup();
    await settle();
    expect(coordinator.state()).toEqual({ status: 'pending', intent });
    http.expectNone((request) => request.url.startsWith('/api/'));
    expect(uuid).not.toHaveBeenCalled();
  });

  it('blocks duplicate actions while token renewal or a POST is pending', async () => {
    let release!: (token: string) => void;
    auth.getAccessToken.mockReturnValueOnce(
      new Promise((resolve) => {
        release = resolve;
      }),
    );
    coordinator.submit(address);
    coordinator.submit(address);
    coordinator.recover();
    coordinator.restore();
    expect(uuid).toHaveBeenCalledOnce();
    release('test-token');
    await settle();
    const post = http.expectOne('/api/v1/orders');
    coordinator.submit(address);
    coordinator.recover();
    http.expectNone('/api/v1/orders');
    post.flush(order, { status: 201, statusText: 'Created' });
  });

  it.each([400, 401, 403, 404, 409, 500, 502, 503, 504])(
    'keeps the same intention on POST %s without automatic retry',
    async (status) => {
      const post = await submit();
      const original = entries.get(storageKey);
      post.flush({ detail: 'Internal secret details' }, { status, statusText: 'Failure' });
      expect(stateError().message).not.toContain('Internal secret details');
      expect(stateError().unauthorized).toBe(status === 401);
      expect(stateError().uncertain).toBe(true);
      expect(entries.get(storageKey)).toBe(original);
      await settle();
      http.expectNone('/api/v1/orders');
      coordinator.submit({ ...address, city: 'Porto' });
      await settle();
      expect(stateError().message).toContain('tentativa pendente');
      http.expectNone('/api/v1/orders');
      coordinator.recover();
      await settle();
      const retry = http.expectOne('/api/v1/orders');
      expect(retry.request.body).toEqual(JSON.parse(original!).request);
      expect(retry.request.headers.get('Idempotency-Key')).toBe(key);
      retry.flush(order, { status: 201, statusText: 'Created' });
      expect(uuid).toHaveBeenCalledOnce();
    },
  );

  it('recovers a lost response with exactly the original body after recarga', async () => {
    const post = await submit();
    const original = stored();
    post.error(new ProgressEvent('error'));
    expect(stateError().uncertain).toBe(true);
    TestBed.resetTestingModule();
    vi.restoreAllMocks();
    setup();
    await settle();
    http.expectNone('/api/v1/orders');
    coordinator.recover();
    await settle();
    const replay = http.expectOne('/api/v1/orders');
    expect(replay.request.body).toEqual(original.request);
    expect(replay.request.headers.get('Idempotency-Key')).toBe(original.idempotencyKey);
    replay.flush(order, { status: 201, statusText: 'Created' });
    expect(uuid).not.toHaveBeenCalled();
  });

  it('times out without replay and permits only an explicit recovery', async () => {
    vi.useFakeTimers();
    const post = await submit();
    const original = entries.get(storageKey);
    await vi.advanceTimersByTimeAsync(10001);
    expect(post.cancelled).toBe(true);
    expect(stateError().uncertain).toBe(true);
    expect(entries.get(storageKey)).toBe(original);
    http.expectNone('/api/v1/orders');
    coordinator.recover();
    await settle();
    http.expectOne('/api/v1/orders').flush(order, { status: 201, statusText: 'Created' });
  });

  it('cancels an interrupted submission while retaining the uncertain attempt', async () => {
    const post = await submit();
    const original = entries.get(storageKey);
    coordinator.cancel();
    expect(post.cancelled).toBe(true);
    expect(stateError().uncertain).toBe(true);
    expect(entries.get(storageKey)).toBe(original);
    coordinator.recover();
    await settle();
    http.expectOne('/api/v1/orders').flush(order, { status: 201, statusText: 'Created' });
  });

  it('cancels on service destruction and restores only local state in a new instance', async () => {
    const post = await submit();
    TestBed.resetTestingModule();
    expect(post.cancelled).toBe(true);
    vi.restoreAllMocks();
    setup();
    await settle();
    expect(coordinator.state().status).toBe('pending');
    http.expectNone('/api/v1/orders');
  });

  it.each([
    [200, order],
    [202, order],
    [201, null],
    [201, { ...order, id: 'invalid' }],
    [201, { ...order, items: null }],
    [201, { ...order, totalAmount: '25' }],
    [201, { ...order, currency: null }],
    [201, { ...order, updatedAt: 'invalid' }],
  ])('treats incompatible success %s as uncertain', async (status, body) => {
    const post = await submit();
    const original = entries.get(storageKey);
    post.flush(body, { status, statusText: 'Success' });
    expect(stateError().uncertain).toBe(true);
    expect(entries.get(storageKey)).toBe(original);
    expect(coordinator.state()).not.toHaveProperty('order');
    http.expectNone(`/api/v1/orders/${orderId}`);
  });

  it('keeps a known ID in memory when saving fails and recovers by GET instead of POST', async () => {
    const post = await submit();
    const original = entries.get(storageKey);
    vi.mocked(storage.setItem).mockImplementationOnce(() => {
      throw new Error('quota');
    });
    post.flush(order, { status: 201, statusText: 'Created' });
    expect(coordinator.state()).toEqual({ status: 'success', order, persisted: false });
    expect(entries.get(storageKey)).toBe(original);
    coordinator.recover();
    await settle();
    const get = http.expectOne(`/api/v1/orders/${orderId}`);
    expect(get.request.method).toBe('GET');
    get.flush({ ...order, status: 'PENDING_PAYMENT' });
    expect(stored().orderId).toBe(orderId);
    expect(stored()).not.toHaveProperty('request');
    expect(coordinator.state()).toEqual({
      status: 'success',
      order: { ...order, status: 'PENDING_PAYMENT' },
      persisted: true,
    });
    http.expectNone('/api/v1/orders');
  });

  it('continues to use GET for a memory-known order when reading storage fails', async () => {
    const post = await submit();
    post.flush(order, { status: 201, statusText: 'Created' });
    vi.mocked(storage.getItem).mockImplementation(() => {
      throw new Error('blocked');
    });
    coordinator.recover();
    await settle();
    http.expectOne(`/api/v1/orders/${orderId}`).flush(order);
    expect(coordinator.state()).toEqual({ status: 'success', order, persisted: false });
    http.expectNone('/api/v1/orders');
  });

  it('preserves an unsaved known ID across technical expiration and same-account reauthentication', async () => {
    const post = await submit();
    vi.mocked(storage.setItem).mockImplementationOnce(() => {
      throw new Error('quota');
    });
    post.flush(order, { status: 201, statusText: 'Created' });
    auth.state.set({ status: 'anonymous' });
    await settle();
    expect(coordinator.state().status).toBe('sign-in');
    auth.state.set({ status: 'authenticated', username: 'Mesmo cliente' });
    await settle();
    expect(coordinator.state()).toEqual({ status: 'known', orderId });
    http.expectNone((request) => request.url.startsWith('/api/'));
    coordinator.recover();
    await settle();
    http.expectOne(`/api/v1/orders/${orderId}`).flush(order);
    http.expectNone('/api/v1/orders');
  });

  it('loads a durable known ID only on explicit recovery, including after recreation', async () => {
    store.begin(address);
    store.recordOrder(key, orderId);
    TestBed.resetTestingModule();
    vi.restoreAllMocks();
    setup();
    await settle();
    expect(coordinator.state()).toEqual({ status: 'known', orderId });
    http.expectNone((request) => request.url.startsWith('/api/'));
    coordinator.recover();
    coordinator.recover();
    await settle();
    http.expectOne(`/api/v1/orders/${orderId}`).flush(order);
    http.expectNone('/api/v1/orders');
  });

  it.each([401, 403, 404, 503])(
    'retains a known ID on GET %s and never creates a new order',
    async (status) => {
      store.begin(address);
      store.recordOrder(key, orderId);
      coordinator.recover();
      await settle();
      http.expectOne(`/api/v1/orders/${orderId}`).flush({}, { status, statusText: 'Failure' });
      expect(stateError().uncertain).toBe(false);
      expect(stateError().orderId).toBe(orderId);
      expect(stored().orderId).toBe(orderId);
      coordinator.recover();
      await settle();
      http.expectOne(`/api/v1/orders/${orderId}`).flush(order);
      http.expectNone('/api/v1/orders');
    },
  );

  it('rejects a GET response for a different order and retains the correct reference', async () => {
    store.begin(address);
    store.recordOrder(key, orderId);
    coordinator.recover();
    await settle();
    http.expectOne(`/api/v1/orders/${orderId}`).flush({ ...order, id: productId });
    expect(stateError().orderId).toBe(orderId);
    expect(stored().orderId).toBe(orderId);
  });

  it('does not create an order without a stored intention during recovery', async () => {
    coordinator.recover();
    await settle();
    expect(stateError().message).toContain('Não existe');
    http.expectNone((request) => request.url.startsWith('/api/'));
    expect(uuid).not.toHaveBeenCalled();
  });

  it('does not POST when storage is unavailable, corrupt or address validation fails', async () => {
    vi.mocked(storage.setItem).mockImplementationOnce(() => {
      throw new Error('blocked');
    });
    coordinator.submit(address);
    await settle();
    expect(stateError().message).toContain('guardar');
    entries.set(storageKey, '{broken');
    coordinator.submit(address);
    coordinator.recover();
    await settle();
    expect(entries.get(storageKey)).toBe('{broken');
    entries.delete(storageKey);
    coordinator.submit({ ...address, recipient: ' ' });
    await settle();
    expect(stateError().message).toContain('endereço');
    http.expectNone((request) => request.url.startsWith('/api/'));
  });

  it('does not send while the session is anonymous or an auth action is pending', async () => {
    auth.state.set({ status: 'anonymous' });
    coordinator.submit(address);
    coordinator.recover();
    await settle();
    expect(coordinator.state().status).toBe('sign-in');
    auth.state.set({ status: 'authenticated', username: 'Cliente' });
    auth.actionPending.set(true);
    coordinator.submit(address);
    coordinator.recover();
    await settle();
    http.expectNone((request) => request.url.startsWith('/api/'));
    expect(uuid).not.toHaveBeenCalled();
  });

  it('preserves expiration recovery without sending after reauthentication', async () => {
    const post = await submit();
    const original = entries.get(storageKey);
    auth.state.set({ status: 'anonymous' });
    expect(coordinator.state().status).toBe('sign-in');
    await settle();
    expect(post.cancelled).toBe(true);
    expect(entries.get(storageKey)).toBe(original);
    auth.state.set({ status: 'authenticated', username: 'Cliente' });
    await settle();
    expect(coordinator.state().status).toBe('pending');
    http.expectNone('/api/v1/orders');
    coordinator.recover();
    await settle();
    http.expectOne('/api/v1/orders').flush(order, { status: 201, statusText: 'Created' });
  });

  it('cancels a waiting token before HTTP if the account changes', async () => {
    let release!: (token: string) => void;
    auth.getAccessToken.mockReturnValueOnce(
      new Promise((resolve) => {
        release = resolve;
      }),
    );
    coordinator.submit(address);
    account.set('account-two');
    await settle();
    release('late-token');
    await settle();
    expect(coordinator.state().status).toBe('idle');
    http.expectNone('/api/v1/orders');
    expect(entries.has(storageKey)).toBe(false);
  });

  it('hides results synchronously on account change and ignores an old response before effects run', async () => {
    const post = await submit();
    account.set('account-two');
    expect(coordinator.state()).toEqual({ status: 'idle' });
    post.flush(order, { status: 201, statusText: 'Created' });
    await settle();
    expect(coordinator.state()).toEqual({ status: 'idle' });
    expect(entries.has(storageKey)).toBe(false);
  });

  it('stops an explicit logout before session state changes and does not recreate its record', async () => {
    const post = await submit();
    explicitLogout.next();
    expect(post.cancelled).toBe(true);
    expect(coordinator.state()).toEqual({ status: 'idle' });
    expect(entries.has(storageKey)).toBe(false);
    await settle();
    http.expectNone('/api/v1/orders');
  });

  it('handles synchronous success and an empty GET response without keeping the operation lock', () => {
    const api = TestBed.inject(OrderApi);
    vi.spyOn(api, 'createOrderResponse').mockReturnValueOnce(
      of(new HttpResponse({ status: 201, body: order })),
    );
    coordinator.submit(address);
    expect(coordinator.state().status).toBe('success');
    vi.spyOn(api, 'getOrder').mockReturnValueOnce(of());
    coordinator.recover();
    expect(stateError().orderId).toBe(orderId);
  });

  it('applies an overall deadline even when token acquisition never completes', async () => {
    vi.useFakeTimers();
    vi.spyOn(TestBed.inject(OrderApi), 'createOrderResponse').mockReturnValueOnce(NEVER);
    coordinator.submit(address);
    await vi.advanceTimersByTimeAsync(10001);
    expect(stateError().uncertain).toBe(true);
    expect(stored().idempotencyKey).toBe(key);
    http.expectNone('/api/v1/orders');
  });
});
