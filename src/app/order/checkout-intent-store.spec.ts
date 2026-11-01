import { DOCUMENT } from '@angular/common';
import { ApplicationInitStatus, computed, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { Subject } from 'rxjs';
import { AuthService, AuthState } from '../auth/auth.service';
import { appConfig } from '../app.config';
import { ShippingAddressRequest } from './order-api';
import { CheckoutIntentError, CheckoutIntentStore } from './checkout-intent-store';

const storageKey = 'shopsphere.checkout-intent';
const key = '30000000-0000-4000-8000-000000000001';
const orderId = '20000000-0000-0000-0000-000000000001';
const address: ShippingAddressRequest = {
  recipient: ' Destinatário de teste ',
  addressLine: ' Rua de teste, 1 ',
  addressLine2: '  ',
  city: ' Lisboa ',
  postalCode: ' 1000-001 ',
  countryCode: ' pt ',
};

describe('CheckoutIntentStore', () => {
  const account = signal<string | undefined>('account-one');
  const explicitLogout = new Subject<void>();
  const auth = {
    state: signal<AuthState>({ status: 'authenticated', username: 'Cliente' }),
    subject: computed((): string | undefined =>
      auth.state().status === 'authenticated' ? account() : undefined,
    ),
    explicitLogout: explicitLogout.asObservable(),
    initialize: vi.fn(async () => {}),
  };
  let store: CheckoutIntentStore;
  let entries: Map<string, string>;
  let storage: Storage;
  let uuid: ReturnType<typeof vi.spyOn>;
  let storageGetter: ReturnType<typeof vi.spyOn>;

  function setup() {
    TestBed.configureTestingModule({ providers: [{ provide: AuthService, useValue: auth }] });
    const window = TestBed.inject(DOCUMENT).defaultView!;
    storageGetter = vi.spyOn(window, 'sessionStorage', 'get').mockReturnValue(storage);
    uuid = vi.spyOn(window.crypto, 'randomUUID').mockReturnValue(key);
    store = TestBed.inject(CheckoutIntentStore);
  }

  beforeEach(() => {
    account.set('account-one');
    auth.state.set({ status: 'authenticated', username: 'Cliente' });
    auth.initialize.mockClear();
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
    TestBed.resetTestingModule();
    vi.restoreAllMocks();
  });

  function errorCode(action: () => unknown, code: string) {
    try {
      action();
      throw new Error('Expected CheckoutIntentError');
    } catch (error) {
      expect(error).toBeInstanceOf(CheckoutIntentError);
      expect((error as CheckoutIntentError).code).toBe(code);
      expect((error as Error).message).not.toContain('Destinatário');
    }
  }

  it('creates one immutable normalized body and stores only its owner, version and key', () => {
    expect(store.read()).toBeNull();
    expect(uuid).not.toHaveBeenCalled();
    const original = { ...address };
    const intent = store.begin(original);
    expect(uuid).toHaveBeenCalledOnce();
    expect(intent).toEqual({
      version: 1,
      subject: 'account-one',
      idempotencyKey: key,
      request: {
        shippingAddress: {
          recipient: 'Destinatário de teste',
          addressLine: 'Rua de teste, 1',
          addressLine2: null,
          city: 'Lisboa',
          postalCode: '1000-001',
          countryCode: 'PT',
        },
      },
    });
    original.recipient = 'Alterado';
    expect(intent.request.shippingAddress.recipient).toBe('Destinatário de teste');
    expect(Object.isFrozen(intent)).toBe(true);
    expect(Object.isFrozen(intent.request)).toBe(true);
    expect(Object.isFrozen(intent.request.shippingAddress)).toBe(true);
    expect(() => {
      (intent.request.shippingAddress as ShippingAddressRequest).city = 'Outra';
    }).toThrow();
    expect(JSON.parse(entries.get(storageKey)!)).toEqual(intent);
    expect(entries.size).toBe(1);
    expect(entries.get(storageKey)).not.toMatch(/token|customerId|items|totalAmount/);
  });

  it('restores the exact key and body after service recreation without generating another key', () => {
    const intent = store.begin(address);
    TestBed.resetTestingModule();
    vi.restoreAllMocks();
    setup();
    expect(store.read()).toEqual(intent);
    expect(uuid).not.toHaveBeenCalled();
    expect(Object.isFrozen(store.read()!.request!.shippingAddress)).toBe(true);
  });

  it('does not normalize an already stored body on recovery', () => {
    store.begin(address);
    const saved = JSON.parse(entries.get(storageKey)!);
    saved.request.shippingAddress.recipient = ' Nome preservado ';
    saved.request.shippingAddress.addressLine2 = '';
    const raw = JSON.stringify(saved);
    entries.set(storageKey, raw);
    expect(store.read()).toEqual(saved);
    expect(entries.get(storageKey)).toBe(raw);
  });

  it('blocks replacement of a pending checkout even with a changed address', () => {
    const first = store.begin(address);
    errorCode(() => store.begin({ ...address, city: 'Porto' }), 'pending');
    expect(store.read()).toEqual(first);
    expect(uuid).toHaveBeenCalledOnce();
  });

  it('records the order and removes personal address in one write; a known order permits a new intention', () => {
    store.begin(address);
    const known = store.recordOrder(key, orderId);
    expect(known).toEqual({ version: 1, subject: 'account-one', idempotencyKey: key, orderId });
    expect(store.read()).toEqual(known);
    expect(entries.get(storageKey)).not.toContain('shippingAddress');
    expect(store.recordOrder(key, orderId)).toEqual(known);
    const nextKey = '30000000-0000-4000-8000-000000000002';
    uuid.mockReturnValueOnce(nextKey);
    expect(store.begin(address).idempotencyKey).toBe(nextKey);
  });

  it('preserves the pending body if writing a successful order reference fails', () => {
    const pending = store.begin(address);
    vi.mocked(storage.setItem).mockImplementationOnce(() => {
      throw new DOMException('QuotaExceeded', 'QuotaExceededError');
    });
    errorCode(() => store.recordOrder(key, orderId), 'storage');
    expect(store.read()).toEqual(pending);
  });

  it('rejects stale keys, invalid order IDs and replacing a known order with another', () => {
    store.begin(address);
    errorCode(() => store.recordOrder('other-key', orderId), 'mismatch');
    errorCode(() => store.recordOrder(key, 'invalid'), 'mismatch');
    store.recordOrder(key, orderId);
    errorCode(() => store.recordOrder(key, '20000000-0000-0000-0000-000000000002'), 'mismatch');
    expect(store.read()!.orderId).toBe(orderId);
  });

  it.each(['initializing', 'anonymous', 'unavailable'] as const)(
    'hides and preserves the intent while %s',
    (status) => {
      const pending = store.begin(address);
      auth.state.set({ status });
      TestBed.tick();
      errorCode(() => store.read(), 'session');
      errorCode(() => store.begin(address), 'session');
      expect(JSON.parse(entries.get(storageKey)!)).toEqual(pending);
      auth.state.set({ status: 'authenticated', username: 'Outro nome' });
      TestBed.tick();
      expect(store.read()).toEqual(pending);
    },
  );

  it('refuses access without a stable subject', () => {
    account.set(undefined);
    errorCode(() => store.begin(address), 'session');
    expect(storage.setItem).not.toHaveBeenCalled();
  });

  it('keeps the same intention across display name changes and token refresh', () => {
    const pending = store.begin(address);
    auth.state.set({ status: 'authenticated', username: 'Nome atualizado' });
    TestBed.tick();
    expect(store.read()).toEqual(pending);
    expect(storage.removeItem).not.toHaveBeenCalled();
  });

  it('clears another account data eagerly and does not expose it before the effect runs', () => {
    store.begin(address);
    account.set('account-two');
    expect(store.read()).toBeNull();
    expect(entries.has(storageKey)).toBe(false);
    account.set('account-one');
    TestBed.tick();
    store.begin(address);
    account.set('account-three');
    TestBed.tick();
    expect(entries.has(storageKey)).toBe(false);
  });

  it('clears a previous account record on a fresh application session', () => {
    store.begin(address);
    TestBed.resetTestingModule();
    vi.restoreAllMocks();
    account.set('account-two');
    setup();
    TestBed.tick();
    expect(entries.has(storageKey)).toBe(false);
    expect(store.read()).toBeNull();
  });

  it('removes the intention immediately on explicit logout, preserving unrelated application records', () => {
    store.begin(address);
    entries.set('unrelated', 'preserve');
    explicitLogout.next();
    expect(entries.has(storageKey)).toBe(false);
    expect(entries.get('unrelated')).toBe('preserve');
    expect(store.read()).toBeNull();
  });

  it('blocks recovery while a logout cleanup failure persists and retries before reuse', () => {
    store.begin(address);
    vi.mocked(storage.removeItem).mockImplementation(() => {
      throw new Error('blocked');
    });
    expect(() => explicitLogout.next()).not.toThrow();
    errorCode(() => store.read(), 'storage');
    vi.mocked(storage.removeItem).mockImplementation((key: string) => {
      entries.delete(key);
    });
    expect(store.read()).toBeNull();
  });

  it('does not create a new account intention when deleting the previous account record fails', () => {
    const pending = store.begin(address);
    account.set('account-two');
    vi.mocked(storage.removeItem).mockImplementation(() => {
      throw new Error('blocked');
    });
    errorCode(() => store.read(), 'storage');
    errorCode(() => store.begin(address), 'storage');
    expect(JSON.parse(entries.get(storageKey)!)).toEqual(pending);
    expect(uuid).toHaveBeenCalledOnce();
  });

  it.each(['{broken', 'null', '[]', '{"version":2}', '{"version":1}'])(
    'blocks malformed or unsupported records: %s',
    (raw) => {
      entries.set(storageKey, raw);
      errorCode(() => store.read(), 'invalid-record');
      errorCode(() => store.begin(address), 'invalid-record');
      expect(entries.get(storageKey)).toBe(raw);
      expect(uuid).not.toHaveBeenCalled();
    },
  );

  it.each([
    (saved: any) => {
      saved.idempotencyKey = 'invalid';
    },
    (saved: any) => {
      saved.request.shippingAddress.recipient = '';
    },
    (saved: any) => {
      saved.request.shippingAddress.city = 'x'.repeat(101);
    },
    (saved: any) => {
      saved.request.shippingAddress.countryCode = 'pt';
    },
    (saved: any) => {
      saved.request.shippingAddress.addressLine2 = false;
    },
    (saved: any) => {
      saved.request.shippingAddress.token = 'unexpected';
    },
    (saved: any) => {
      saved.request.items = [];
    },
    (saved: any) => {
      saved.orderId = orderId;
    },
  ])('validates stored data without discarding an uncertain intention', (mutate) => {
    store.begin(address);
    const saved = JSON.parse(entries.get(storageKey)!);
    mutate(saved);
    const raw = JSON.stringify(saved);
    entries.set(storageKey, raw);
    errorCode(() => store.read(), 'invalid-record');
    expect(entries.get(storageKey)).toBe(raw);
  });

  it.each([
    { ...address, recipient: ' ' },
    { ...address, addressLine: 'x'.repeat(201) },
    { ...address, postalCode: 'x'.repeat(21) },
    { ...address, countryCode: 'PRT' },
    { ...address, addressLine2: 'x'.repeat(201) },
  ])('rejects invalid input before persisting or generating a UUID', (input) => {
    errorCode(() => store.begin(input), 'invalid-address');
    expect(uuid).not.toHaveBeenCalled();
    expect(storage.setItem).not.toHaveBeenCalled();
  });

  it('fails safely if accessing or reading sessionStorage is blocked', () => {
    storageGetter.mockImplementationOnce(() => {
      throw new Error('blocked');
    });
    errorCode(() => store.read(), 'storage');
    vi.mocked(storage.getItem).mockImplementationOnce(() => {
      throw new Error('blocked');
    });
    errorCode(() => store.begin(address), 'storage');
    expect(storage.setItem).not.toHaveBeenCalled();
  });

  it('does not return an intention as durable if its first write fails', () => {
    vi.mocked(storage.setItem).mockImplementationOnce(() => {
      throw new Error('quota');
    });
    errorCode(() => store.begin(address), 'storage');
    expect(entries.has(storageKey)).toBe(false);
    expect(store.read()).toBeNull();
  });

  it('does not use a fallback key if secure UUID generation is unavailable', () => {
    uuid.mockImplementationOnce(() => {
      throw new Error('unavailable');
    });
    errorCode(() => store.begin(address), 'storage');
    expect(storage.setItem).not.toHaveBeenCalled();
  });

  it('activates cleanup at application initialization without visiting checkout', async () => {
    store.begin(address);
    TestBed.resetTestingModule();
    vi.restoreAllMocks();
    TestBed.configureTestingModule({
      providers: [...appConfig.providers, { provide: AuthService, useValue: auth }],
    });
    vi.spyOn(TestBed.inject(DOCUMENT).defaultView!, 'sessionStorage', 'get').mockReturnValue(
      storage,
    );
    const initialization = TestBed.inject(ApplicationInitStatus);
    await initialization.donePromise;
    expect(auth.initialize).toHaveBeenCalledOnce();
    explicitLogout.next();
    expect(entries.has(storageKey)).toBe(false);
  });
});
