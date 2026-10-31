import { HttpErrorResponse, provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { computed, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideRouter, Router } from '@angular/router';
import { RouterTestingHarness } from '@angular/router/testing';
import { Subject } from 'rxjs';
import { AuthService, AuthState } from '../auth/auth.service';
import { routes } from '../app.routes';
import { OrderApi, OrderResponse } from './order-api';
import { OrderPage } from './order-page';

const id = '20000000-0000-0000-0000-000000000001';
const secondId = '20000000-0000-0000-0000-000000000002';
const order: OrderResponse = {
  id,
  status: 'PENDING_STOCK',
  items: [
    { productId: secondId, productName: 'Livro', quantity: 2, unitPrice: 12.5, lineTotal: 25 },
  ],
  subtotal: 25,
  discountAmount: 2,
  shippingAmount: 4,
  totalAmount: 27,
  currency: 'EUR',
  paymentStatus: null,
  updatedAt: '2026-10-31T12:00:00Z',
};

describe('OrderPage', () => {
  let harness: RouterTestingHarness;
  let http: HttpTestingController;
  const accountId = signal<string | undefined>('account-one');
  const auth = {
    state: signal<AuthState>({ status: 'authenticated', username: 'Cliente' }),
    subject: computed((): string | undefined =>
      auth.state().status === 'authenticated' ? accountId() : undefined,
    ),
    actionPending: signal(false),
    login: vi.fn(),
    getAccessToken: vi.fn(async (): Promise<string | undefined> => 'test-token'),
  };

  beforeEach(async () => {
    accountId.set('account-one');
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
  afterEach(() => http.verify());

  function element() {
    return harness.routeNativeElement!;
  }
  function get(orderId = id) {
    return http.expectOne(`/api/v1/orders/${orderId}`);
  }
  async function open(orderId = id) {
    await harness.navigateByUrl(`/orders/${orderId}`, OrderPage);
    await harness.fixture.whenStable();
  }
  function render(value: object | null = order) {
    get().flush(value);
    harness.detectChanges();
  }
  async function click(selector: string) {
    element().querySelector<HTMLButtonElement>(selector)!.click();
    await harness.fixture.whenStable();
  }

  it('opens a direct route and shows the server snapshots, totals, currency and update date', async () => {
    await open();
    expect(element().textContent).toContain('A carregar pedido');
    const pending = get();
    expect(pending.request.method).toBe('GET');
    expect(pending.request.headers.get('Authorization')).toBe('Bearer test-token');
    pending.flush(order);
    harness.detectChanges();
    expect(element().textContent).toContain(id);
    expect(element().textContent).toContain('Livro');
    expect(element().textContent).toContain('Quantidade: 2');
    expect(element().querySelector('.line-total')?.textContent?.replace(/\s/g, '')).toContain(
      '25,00€',
    );
    const summary = element().querySelector('.summary')!.textContent!.replace(/\s/g, '');
    expect(summary).toContain('Desconto2,00€');
    expect(summary).toContain('Envio4,00€');
    expect(summary).toContain('Total27,00€');
    expect(element().querySelector('time')?.getAttribute('datetime')).toBe(order.updatedAt);
    expect(element().querySelector('time')?.textContent).toContain('31/10/2026');
    expect(element().querySelector('[aria-busy]')?.getAttribute('aria-busy')).toBe('false');
    expect(element().querySelector('input')).toBeNull();
    expect(element().textContent).toContain('O pagamento não está disponível');
    expect(TestBed.inject(Router).routerState.snapshot.root.firstChild?.title).toBe(
      'Pedido | ShopSphere',
    );
  });

  it('uses the currency from the response without recalculating server amounts', async () => {
    await open();
    render({ ...order, currency: 'USD', totalAmount: 28.75 });
    expect(element().querySelector('.total')?.textContent?.replace(/\s/g, '')).toContain(
      '28,75US$',
    );
  });

  it.each([
    ['PENDING_STOCK', 'Pedido criado; a aguardar verificação de estoque'],
    ['PENDING_PAYMENT', 'A aguardar pagamento; pagamento indisponível nesta fase'],
    ['CANCELLED', 'Pedido cancelado'],
    ['CONFIRMED', 'Pedido confirmado'],
    ['PROCESSING', 'Em processamento'],
    ['SHIPPED', 'Enviado'],
    ['DELIVERED', 'Entregue'],
    ['PAYMENT_FAILED', 'Falha no pagamento'],
    ['PENDING', 'Pendente'],
    ['COMPLETED', 'Concluído'],
    ['NEW_STATUS', 'Estado indisponível'],
    ['toString', 'Estado indisponível'],
  ])('presents status %s without inventing actions or reasons', async (status, label) => {
    await open();
    render({ ...order, status });
    expect(element().querySelector('.order-status')?.textContent?.trim()).toBe(label);
    expect(element().querySelectorAll('button').length).toBe(1);
    expect(element().textContent).not.toContain('Pagamento confirmado');
    expect(element().textContent).not.toContain('Sem estoque');
  });

  it('asks for login without requesting private data and reads only after authentication', async () => {
    auth.state.set({ status: 'anonymous' });
    await open();
    expect(element().textContent).toContain('Entre para consultar o seu pedido');
    http.expectNone((req) => req.url.startsWith('/api/'));
    await click('button');
    expect(auth.login).toHaveBeenCalledWith();
    expect(TestBed.inject(Router).url).toBe(`/orders/${id}`);
    auth.state.set({ status: 'authenticated', username: 'Cliente' });
    await harness.fixture.whenStable();
    render();
    http.expectNone((req) => req.method === 'POST');
  });

  it.each(['initializing', 'unavailable'] as const)(
    'does not request orders or allow login while %s',
    async (status) => {
      auth.state.set({ status });
      await open();
      expect(element().querySelector<HTMLButtonElement>('button')?.disabled).toBe(true);
      http.expectNone((req) => req.url.startsWith('/api/'));
    },
  );

  it('refuses to load private data without a stable subject', async () => {
    accountId.set(undefined);
    await open();
    expect(element().textContent).toContain('Não foi possível verificar a conta');
    http.expectNone((req) => req.url.startsWith('/api/'));
    await click('.state-message button');
    expect(auth.login).toHaveBeenCalledWith(true);
  });

  it('handles invalid UUIDs locally and treats a server 404 as a generic missing order', async () => {
    await open('invalid');
    expect(element().textContent).toContain('Pedido não encontrado');
    http.expectNone((req) => req.url.startsWith('/api/'));
    await open();
    get().flush(
      { detail: 'Order owned by somebody else' },
      { status: 404, statusText: 'Not Found' },
    );
    harness.detectChanges();
    expect(element().textContent).toContain('Pedido não encontrado');
    expect(element().textContent).not.toContain('somebody else');
    expect(element().querySelector('button')).toBeNull();
  });

  it.each([401, 403, 503, 0])(
    'handles failure %s safely without an automatic retry',
    async (status) => {
      await open();
      const pending = get();
      if (status === 0) pending.error(new ProgressEvent('error'));
      else pending.flush({ detail: 'Internal secret details' }, { status, statusText: 'Failure' });
      harness.detectChanges();
      expect(element().querySelector('[role="alert"]')).not.toBeNull();
      expect(element().textContent).not.toContain('Internal secret details');
      expect(element().textContent).not.toContain('Pedido não encontrado');
      await harness.fixture.whenStable();
      http.expectNone(`/api/v1/orders/${id}`);
      if (status === 401) {
        await click('.state-message button');
        expect(auth.login).toHaveBeenCalledWith(true);
        http.expectNone(`/api/v1/orders/${id}`);
      } else {
        await click('.state-message button');
        render();
        expect(element().textContent).toContain('Livro');
      }
    },
  );

  it('updates only on demand, clears stale data during refresh and blocks duplicate clicks', async () => {
    await open();
    render();
    await harness.fixture.whenStable();
    http.expectNone(`/api/v1/orders/${id}`);
    await click('.refresh');
    expect(element().textContent).not.toContain('Livro');
    expect(element().querySelector<HTMLButtonElement>('.refresh')?.disabled).toBe(true);
    await click('.refresh');
    const current = get();
    current.flush({ ...order, status: 'CANCELLED' });
    harness.detectChanges();
    expect(element().textContent).toContain('Pedido cancelado');
  });

  it('hides data synchronously on logout and performs a fresh read on a new session', async () => {
    await open();
    render();
    auth.state.set({ status: 'anonymous' });
    harness.detectChanges();
    expect(element().textContent).not.toContain('Livro');
    expect(element().textContent).not.toContain(id);
    await harness.fixture.whenStable();
    auth.state.set({ status: 'authenticated', username: 'Cliente' });
    await harness.fixture.whenStable();
    render();
    expect(element().textContent).toContain('Livro');
  });

  it('cancels pending reads on logout, ID change and leaving the page', async () => {
    await open();
    const loggedOut = get();
    auth.state.set({ status: 'anonymous' });
    await harness.fixture.whenStable();
    expect(loggedOut.cancelled).toBe(true);
    auth.state.set({ status: 'authenticated', username: 'Cliente' });
    await harness.fixture.whenStable();
    const first = get();
    await open(secondId);
    expect(first.cancelled).toBe(true);
    const second = get(secondId);
    await harness.navigateByUrl('/products/invalid');
    expect(second.cancelled).toBe(true);
  });

  it('isolates accounts with the same username and cancels the previous account request', async () => {
    await open();
    render();
    accountId.set('account-two');
    harness.detectChanges();
    expect(element().textContent).not.toContain('Livro');
    await harness.fixture.whenStable();
    const secondAccount = get();
    accountId.set('account-three');
    await harness.fixture.whenStable();
    expect(secondAccount.cancelled).toBe(true);
    get().flush({}, { status: 404, statusText: 'Not Found' });
    harness.detectChanges();
    expect(element().textContent).toContain('Pedido não encontrado');
  });

  it('does not reload on a refreshed token or changed display name for the same subject', async () => {
    auth.getAccessToken.mockImplementation(async () => {
      auth.state.set({ status: 'authenticated', username: 'Nome atualizado' });
      return 'refreshed-token';
    });
    await open();
    render();
    auth.state.set({ status: 'authenticated', username: 'Outro nome' });
    await harness.fixture.whenStable();
    expect(auth.getAccessToken).toHaveBeenCalledOnce();
    http.expectNone(`/api/v1/orders/${id}`);
    expect(element().textContent).toContain('Livro');
  });

  it.each([
    null,
    { ...order, id: secondId },
    { ...order, items: null },
    { ...order, totalAmount: '27.00' },
    { ...order, currency: null },
    { ...order, updatedAt: 'invalid' },
    { ...order, items: [null] },
  ])('handles an incompatible response as a recoverable error', async (response) => {
    await open();
    render(response);
    expect(element().querySelector('[role="alert"]')).not.toBeNull();
    expect(element().querySelector('.summary')).toBeNull();
    await click('.state-message button');
    render();
    expect(element().textContent).toContain('Livro');
  });

  it('renders product names as text and places focus on the page heading', async () => {
    await open();
    render({ ...order, items: [{ ...order.items[0], productName: '<script>test</script>' }] });
    expect(element().querySelector('script')).toBeNull();
    expect(element().querySelector('h3')?.textContent).toBe('<script>test</script>');
    expect(element().querySelector('h1')?.getAttribute('tabindex')).toBe('-1');
    expect(element().ownerDocument.activeElement).toBe(element().querySelector('h1'));
  });

  it('ignores emissions from a previous context even before its subscription is disposed', async () => {
    const stale = new Subject<OrderResponse>();
    vi.spyOn(TestBed.inject(OrderApi), 'getOrder').mockReturnValue(stale);
    await open();
    auth.state.set({ status: 'anonymous' });
    stale.next(order);
    harness.detectChanges();
    expect(element().textContent).not.toContain('Livro');
    expect(element().textContent).toContain('Entre para consultar');
    await harness.fixture.whenStable();
    stale.error(new HttpErrorResponse({ status: 503 }));
    harness.detectChanges();
    expect(element().querySelector('[role="alert"]')).toBeNull();
  });
});
