import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { computed, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideRouter, Router } from '@angular/router';
import { RouterTestingHarness } from '@angular/router/testing';
import { AuthService, AuthState } from '../auth/auth.service';
import { routes } from '../app.routes';
import { CartResponse } from '../cart/cart-api';
import { CheckoutPage } from './checkout-page';

const cart: CartResponse = {
  id: '30000000-0000-0000-0000-000000000001',
  status: 'ACTIVE',
  items: [
    {
      productId: '20000000-0000-0000-0000-000000000001',
      productName: 'Livro',
      quantity: 2,
      unitPrice: 12.5,
      subTotal: 25,
    },
  ],
  totalItems: 1,
  estimatedTotal: 25,
  currency: 'EUR',
  updatedAt: '2026-11-01T00:00:00Z',
};

describe('CheckoutPage', () => {
  let harness: RouterTestingHarness;
  let http: HttpTestingController;
  const account = signal<string | undefined>('account-one');
  const auth = {
    state: signal<AuthState>({ status: 'authenticated', username: 'Cliente' }),
    subject: computed((): string | undefined =>
      auth.state().status === 'authenticated' ? account() : undefined,
    ),
    actionPending: signal(false),
    login: vi.fn(),
    getAccessToken: vi.fn(async (): Promise<string | undefined> => 'test-token'),
  };
  beforeEach(async () => {
    account.set('account-one');
    auth.state.set({ status: 'authenticated', username: 'Cliente' });
    auth.actionPending.set(false);
    auth.login.mockReset();
    auth.getAccessToken.mockReset().mockResolvedValue('test-token');
    await TestBed.configureTestingModule({
      providers: [
        provideHttpClient(),
        provideHttpClientTesting(),
        provideRouter(routes),
        { provide: AuthService, useValue: auth },
      ],
    }).compileComponents();
    http = TestBed.inject(HttpTestingController);
    harness = await RouterTestingHarness.create();
  });
  afterEach(() => {
    http.expectNone((req) => req.method !== 'GET');
    http.expectNone((req) => req.url.startsWith('/api/v1/orders'));
    http.verify();
    vi.restoreAllMocks();
  });
  function element() {
    return harness.routeNativeElement!;
  }
  async function open() {
    await harness.navigateByUrl('/checkout?name=Livro', CheckoutPage);
    await harness.fixture.whenStable();
  }
  function get() {
    return http.expectOne('/api/v1/carts/me');
  }
  function render(value: object | null = cart) {
    get().flush(value);
    harness.detectChanges();
  }
  async function click(selector: string) {
    element().querySelector<HTMLButtonElement>(selector)!.click();
    await harness.fixture.whenStable();
  }

  it('loads a direct route through CartApi and renders server prices, quantities and estimated total', async () => {
    await open();
    expect(element().textContent).toContain('A carregar carrinho');
    const pending = get();
    expect(pending.request.headers.get('Authorization')).toBe('Bearer test-token');
    expect(pending.request.method).toBe('GET');
    pending.flush(cart);
    harness.detectChanges();
    expect(element().querySelector('h1')?.textContent).toBe('Rever checkout');
    expect(element().textContent).toContain('Livro');
    expect(element().textContent).toContain('Quantidade: 2');
    expect(element().querySelector('.estimated-total')?.textContent?.replace(/\s/g, '')).toContain(
      '25,00€',
    );
    expect(element().textContent).toContain('preços serão revalidados');
    expect(element().textContent).toContain('estoque ainda será verificado');
    expect(element().querySelectorAll('app-shipping-address-form input').length).toBe(6);
    expect(element().querySelector('[aria-busy]')?.getAttribute('aria-busy')).toBe('false');
    expect(element().querySelector<HTMLAnchorElement>('.back-link')?.getAttribute('href')).toBe(
      '/cart?name=Livro',
    );
    expect(TestBed.inject(Router).routerState.snapshot.root.firstChild?.title).toBe(
      'Checkout | ShopSphere',
    );
    expect(element().ownerDocument.activeElement).toBe(element().querySelector('h1'));
  });

  it('keeps the address editable with creation unavailable, even on a synthetic form submission', async () => {
    const storage = vi.spyOn(Storage.prototype, 'setItem');
    const uuid = vi.spyOn(document.defaultView!.crypto, 'randomUUID');
    await open();
    render();
    expect(element().textContent).toContain('A criação de pedidos ainda não está disponível');
    const confirm = element().querySelector<HTMLButtonElement>('form button')!;
    expect(confirm.disabled).toBe(true);
    for (const input of element().querySelectorAll<HTMLInputElement>('form input')) {
      expect(input.matches(':disabled')).toBe(false);
      input.value = input.name === 'countryCode' ? 'PT' : 'Teste';
      input.dispatchEvent(new Event('input'));
    }
    const event = new Event('submit', { bubbles: true, cancelable: true });
    element().querySelector('form')!.dispatchEvent(event);
    await harness.fixture.whenStable();
    expect(event.defaultPrevented).toBe(true);
    expect(storage).not.toHaveBeenCalled();
    expect(uuid).not.toHaveBeenCalled();
    expect(element().querySelector<HTMLInputElement>('input[name="recipient"]')?.value).toBe(
      'Teste',
    );
    http.expectNone((req) => req.url.startsWith('/api/'));
  });

  it('asks for login without Cart HTTP and reads only after the session becomes authenticated', async () => {
    auth.state.set({ status: 'anonymous' });
    await open();
    expect(element().textContent).toContain('Entre para rever o checkout');
    expect(element().querySelector('form')).toBeNull();
    http.expectNone('/api/v1/carts/me');
    await click('.state-message button');
    expect(auth.login).toHaveBeenCalledWith();
    expect(TestBed.inject(Router).url).toBe('/checkout?name=Livro');
    auth.state.set({ status: 'authenticated', username: 'Cliente' });
    await harness.fixture.whenStable();
    render();
    expect(element().querySelector('form')).not.toBeNull();
  });

  it.each(['initializing', 'unavailable'] as const)(
    'does not read private data or offer login while %s',
    async (status) => {
      auth.state.set({ status });
      await open();
      expect(element().querySelector<HTMLButtonElement>('button')?.disabled).toBe(true);
      http.expectNone('/api/v1/carts/me');
    },
  );

  it('requires a stable subject before reading Cart', async () => {
    account.set(undefined);
    await open();
    http.expectNone('/api/v1/carts/me');
    expect(element().textContent).toContain('Não foi possível verificar a conta');
    await click('.state-message button');
    expect(auth.login).toHaveBeenCalledWith(true);
  });

  it('handles a genuinely missing Cart and a loaded empty Cart as empty without showing a form', async () => {
    await open();
    get().flush({ detail: 'Cart not found' }, { status: 404, statusText: 'Not Found' });
    harness.detectChanges();
    expect(element().textContent).toContain('carrinho ainda está vazio');
    expect(element().querySelector('form')).toBeNull();
    await click('.refresh');
    render({ ...cart, items: [], totalItems: 0, estimatedTotal: 0 });
    expect(element().textContent).toContain('carrinho ainda está vazio');
    expect(element().querySelector('form')).toBeNull();
  });

  it.each(['CHECKED_OUT', 'ABANDONED'])(
    'blocks an inactive %s Cart and links back to editing',
    async (status) => {
      await open();
      render({ ...cart, status });
      expect(element().textContent).toContain('já não está ativo');
      expect(element().querySelector('form')).toBeNull();
      expect(element().querySelector('.state-message a')?.getAttribute('href')).toBe(
        '/cart?name=Livro',
      );
    },
  );

  it.each([100, 101])(
    'applies the limit to %s distinct product IDs rather than the quantity or display count',
    async (size) => {
      await open();
      render({
        ...cart,
        totalItems: 1,
        items: Array.from({ length: size }, (_, index) => ({
          ...cart.items[0],
          productId: `20000000-0000-0000-0000-${String(index + 1).padStart(12, '0')}`,
          quantity: 1000,
        })),
      });
      expect(!!element().querySelector('form')).toBe(size === 100);
      if (size === 101) expect(element().textContent).toContain('até 100 produtos diferentes');
    },
  );

  it.each([401, 403, 409, 503, 0])(
    'handles failure %s safely and only retries on demand',
    async (status) => {
      await open();
      const pending = get();
      if (status === 0) pending.error(new ProgressEvent('error'));
      else pending.flush({ detail: 'Internal secret details' }, { status, statusText: 'Failure' });
      harness.detectChanges();
      expect(element().querySelector('[role="alert"]')).not.toBeNull();
      expect(element().textContent).not.toContain('Internal secret details');
      expect(element().querySelector('form')).toBeNull();
      await harness.fixture.whenStable();
      http.expectNone('/api/v1/carts/me');
      if (status === 401) {
        await click('.state-message button');
        expect(auth.login).toHaveBeenCalledWith(true);
      } else {
        await click('.state-message button');
        render();
        expect(element().querySelector('form')).not.toBeNull();
      }
    },
  );

  it('does not disguise a product or ambiguous 404 as an empty Cart', async () => {
    await open();
    get().flush({ detail: 'Product not found.' }, { status: 404, statusText: 'Not Found' });
    harness.detectChanges();
    expect(element().querySelector('[role="alert"]')).not.toBeNull();
    expect(element().textContent).not.toContain('carrinho ainda está vazio');
  });

  it.each([
    null,
    { ...cart, items: null },
    { ...cart, currency: null },
    { ...cart, estimatedTotal: '25' },
    { ...cart, items: [...cart.items, ...cart.items] },
    { ...cart, items: [{ ...cart.items[0], quantity: -1 }] },
  ])('treats an incompatible Cart response as a recoverable error', async (body) => {
    await open();
    render(body);
    expect(element().querySelector('[role="alert"]')).not.toBeNull();
    expect(element().querySelector('form')).toBeNull();
    await click('.state-message button');
    render();
    expect(element().querySelector('form')).not.toBeNull();
  });

  it('uses the received currency/total and renders product names as text', async () => {
    await open();
    render({
      ...cart,
      estimatedTotal: 31.75,
      currency: 'USD',
      items: [{ ...cart.items[0], productName: '<script>test</script>' }],
    });
    expect(element().querySelector('.estimated-total')?.textContent?.replace(/\s/g, '')).toContain(
      '31,75US$',
    );
    expect(element().querySelector('h3')?.textContent).toBe('<script>test</script>');
    expect(element().querySelector('script')).toBeNull();
  });

  it('refreshes explicitly, blocks duplicate reads and discards the unpersisted draft', async () => {
    await open();
    render();
    const input = element().querySelector<HTMLInputElement>('input[name="recipient"]')!;
    input.value = 'Rascunho';
    input.dispatchEvent(new Event('input'));
    await click('.refresh');
    expect(element().querySelector('form')).toBeNull();
    await click('.refresh');
    render();
    expect(element().querySelector<HTMLInputElement>('input[name="recipient"]')?.value).toBe('');
  });

  it('hides the Cart and clears address fields immediately on logout or same-name account switch', async () => {
    await open();
    render();
    const input = element().querySelector<HTMLInputElement>('input[name="recipient"]')!;
    input.value = 'Endereço da primeira conta';
    input.dispatchEvent(new Event('input'));
    account.set('account-two');
    harness.detectChanges();
    expect(element().querySelector('form')).toBeNull();
    expect(element().textContent).not.toContain('Livro');
    await harness.fixture.whenStable();
    render();
    expect(element().querySelector<HTMLInputElement>('input[name="recipient"]')?.value).toBe('');
    auth.state.set({ status: 'anonymous' });
    harness.detectChanges();
    expect(element().querySelector('form')).toBeNull();
    await harness.fixture.whenStable();
    expect(element().textContent).toContain('Entre para rever');
  });

  it('cancels old reads on account changes, session end and leaving checkout', async () => {
    await open();
    const first = get();
    account.set('account-two');
    await harness.fixture.whenStable();
    expect(first.cancelled).toBe(true);
    const second = get();
    auth.state.set({ status: 'anonymous' });
    await harness.fixture.whenStable();
    expect(second.cancelled).toBe(true);
    auth.state.set({ status: 'authenticated', username: 'Cliente' });
    await harness.fixture.whenStable();
    const third = get();
    await harness.navigateByUrl('/products/invalid');
    expect(third.cancelled).toBe(true);
  });

  it('does not reload or discard the draft when a token or display name changes within the same account', async () => {
    auth.getAccessToken.mockImplementation(async () => {
      auth.state.set({ status: 'authenticated', username: 'Atualizado' });
      return 'refreshed-token';
    });
    await open();
    render();
    const input = element().querySelector<HTMLInputElement>('input[name="recipient"]')!;
    input.value = 'Rascunho';
    input.dispatchEvent(new Event('input'));
    auth.state.set({ status: 'authenticated', username: 'Outro nome' });
    await harness.fixture.whenStable();
    http.expectNone('/api/v1/carts/me');
    expect(auth.getAccessToken).toHaveBeenCalledOnce();
    expect(element().querySelector<HTMLInputElement>('input[name="recipient"]')?.value).toBe(
      'Rascunho',
    );
  });

  it('never mounts an address form for a stale response arriving during account change', async () => {
    await open();
    const stale = get();
    account.set('account-two');
    stale.flush(cart);
    harness.detectChanges();
    expect(element().querySelector('form')).toBeNull();
    await harness.fixture.whenStable();
    render();
    expect(element().querySelector('form')).not.toBeNull();
  });
});
