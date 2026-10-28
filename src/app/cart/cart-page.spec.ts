import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { signal } from '@angular/core';
import { provideRouter } from '@angular/router';
import { RouterTestingHarness } from '@angular/router/testing';
import { routes } from '../app.routes';
import { AuthService, AuthState } from '../auth/auth.service';
import { CartResponse } from './cart-api';

const productId = '20000000-0000-0000-0000-000000000001';
const cart: CartResponse = {
  id: 'cart-id',
  status: 'ACTIVE',
  items: [{ productId, productName: 'Livro', quantity: 2, unitPrice: 12.5, subTotal: 25 }],
  totalItems: 1,
  estimatedTotal: 25,
  currency: 'EUR',
  updatedAt: '2026-10-27T00:00:00Z',
};

describe('CartPage', () => {
  let harness: RouterTestingHarness;
  let http: HttpTestingController;
  const auth = {
    state: signal<AuthState>({ status: 'authenticated', username: 'Cliente' }),
    actionPending: signal(false),
    login: vi.fn(),
    getAccessToken: vi.fn(async () => 'test-token'),
  };
  beforeEach(async () => {
    auth.state.set({ status: 'authenticated', username: 'Cliente' });
    auth.login.mockClear();
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
  async function open() {
    await harness.navigateByUrl('/cart?name=Livro');
    await harness.fixture.whenStable();
  }
  function get() {
    return http.expectOne('/api/v1/carts/me');
  }
  async function loaded() {
    await open();
    get().flush(cart);
    harness.detectChanges();
  }

  it('asks for login without making a cart request when anonymous', async () => {
    auth.state.set({ status: 'anonymous' });
    await open();
    expect(element().textContent).toContain('Entre para consultar');
    element().querySelector<HTMLButtonElement>('button')!.click();
    expect(auth.login).toHaveBeenCalledOnce();
    http.expectNone('/api/v1/carts/me');
  });

  it('renders server totals and distinct product count without enabling checkout', async () => {
    await loaded();
    expect(element().querySelector('h2')?.textContent).toContain('Livro');
    expect(element().querySelector('.estimated-total')?.textContent?.replace(/\s/g, '')).toContain(
      '25,00€',
    );
    expect(element().querySelector<HTMLInputElement>('input')?.value).toBe('2');
    expect(element().querySelector<HTMLButtonElement>('.summary button')?.disabled).toBe(true);
    expect(element().querySelector('.back-link')?.getAttribute('href')).toBe(
      '/?name=Livro#catalogo',
    );
  });

  it('recognizes only the documented missing-cart 404 as empty', async () => {
    await open();
    get().flush({ detail: 'Cart not found' }, { status: 404, statusText: 'Not Found' });
    harness.detectChanges();
    expect(element().textContent).toContain('carrinho ainda está vazio');
    element().querySelector<HTMLButtonElement>('.page-heading button')!.click();
    await harness.fixture.whenStable();
    get().flush({ detail: 'Product not found.' }, { status: 404, statusText: 'Not Found' });
    harness.detectChanges();
    expect(element().textContent).not.toContain('carrinho ainda está vazio');
    expect(element().querySelector('[role="alert"]')?.textContent).toContain(
      'já não pode ser consultado',
    );
  });

  it('updates quantity then reloads current prices and totals from the server', async () => {
    await loaded();
    const input = element().querySelector<HTMLInputElement>('input')!;
    input.value = '3';
    const form = element().querySelector('form')!;
    form.dispatchEvent(new Event('submit', { cancelable: true }));
    form.dispatchEvent(new Event('submit', { cancelable: true }));
    await harness.fixture.whenStable();
    const patch = http.expectOne(`/api/v1/carts/me/items/${productId}`);
    expect(patch.request.method).toBe('PATCH');
    expect(patch.request.body).toEqual({ quantity: 3 });
    patch.flush(null, { status: 204, statusText: 'No Content' });
    await harness.fixture.whenStable();
    get().flush({
      ...cart,
      items: [{ ...cart.items[0], quantity: 3, unitPrice: 11, subTotal: 33 }],
      estimatedTotal: 33,
    });
    harness.detectChanges();
    expect(element().querySelector<HTMLInputElement>('input')?.value).toBe('3');
    expect(element().querySelector('.estimated-total')?.textContent?.replace(/\s/g, '')).toContain(
      '33,00€',
    );
  });

  it('removes an item and reflects an empty server cart', async () => {
    await loaded();
    element().querySelector<HTMLButtonElement>('[aria-label="Remover Livro"]')!.click();
    await harness.fixture.whenStable();
    const remove = http.expectOne(`/api/v1/carts/me/items/${productId}`);
    expect(remove.request.method).toBe('DELETE');
    remove.flush(null, { status: 204, statusText: 'No Content' });
    await harness.fixture.whenStable();
    get().flush({ ...cart, items: [], totalItems: 0, estimatedTotal: 0 });
    harness.detectChanges();
    expect(element().textContent).toContain('carrinho ainda está vazio');
    expect(element().querySelector('.summary')).toBeNull();
  });

  it.each([401, 403, 404, 409, 503])(
    'handles mutation status %s without repeating or pretending success',
    async (status) => {
      await loaded();
      element().querySelector<HTMLButtonElement>('[aria-label="Remover Livro"]')!.click();
      await harness.fixture.whenStable();
      http
        .expectOne(`/api/v1/carts/me/items/${productId}`)
        .flush({ detail: 'Internal details' }, { status, statusText: 'Failure' });
      harness.detectChanges();
      expect(element().querySelector('.error-message')).not.toBeNull();
      expect(element().textContent).not.toContain('Internal details');
      expect(element().querySelector<HTMLInputElement>('input')?.disabled).toBe(true);
      http.expectNone((req) => req.method !== 'GET');
      if (status === 401) {
        Array.from(element().querySelectorAll<HTMLButtonElement>('button'))
          .find((button) => button.textContent?.includes('Entrar novamente'))!
          .click();
        expect(auth.login).toHaveBeenCalledWith(true);
      }
      element().querySelector<HTMLButtonElement>('.page-heading button')!.click();
      await harness.fixture.whenStable();
      get().flush(cart);
      harness.detectChanges();
      expect(element().querySelector<HTMLInputElement>('input')?.disabled).toBe(false);
    },
  );

  it('allows renewed auth state without repeatedly reloading the cart', async () => {
    auth.getAccessToken.mockImplementation(async () => {
      auth.state.set({ status: 'authenticated', username: 'Cliente' });
      return 'test-token';
    });
    await loaded();
    await harness.fixture.whenStable();
    http.expectNone('/api/v1/carts/me');
    expect(element().textContent).toContain('Livro');
  });

  it('hides loaded cart data on logout and fetches fresh data for the next session', async () => {
    await loaded();
    auth.state.set({ status: 'anonymous' });
    await harness.fixture.whenStable();
    expect(element().querySelector('.cart-items')).toBeNull();
    auth.state.set({ status: 'authenticated', username: 'Outro cliente' });
    await harness.fixture.whenStable();
    expect(element().querySelector('.cart-items')).toBeNull();
    get().flush({ ...cart, items: [], totalItems: 0, estimatedTotal: 0 });
    harness.detectChanges();
    expect(element().textContent).toContain('carrinho ainda está vazio');
  });

  it('offers reauthentication for a rejected read without showing an empty cart', async () => {
    await open();
    get().flush({}, { status: 401, statusText: 'Unauthorized' });
    harness.detectChanges();
    expect(element().textContent).not.toContain('carrinho ainda está vazio');
    element().querySelector<HTMLButtonElement>('.state-message button')!.click();
    expect(auth.login).toHaveBeenCalledWith(true);
  });

  it('keeps writes blocked after a network failure until a successful fresh read', async () => {
    await loaded();
    element().querySelector<HTMLButtonElement>('[aria-label="Remover Livro"]')!.click();
    await harness.fixture.whenStable();
    http.expectOne(`/api/v1/carts/me/items/${productId}`).error(new ProgressEvent('error'));
    harness.detectChanges();
    expect(element().querySelector('.error-message')?.textContent).toContain(
      'confirmar a alteração',
    );
    element().querySelector<HTMLButtonElement>('.page-heading button')!.click();
    await harness.fixture.whenStable();
    get().error(new ProgressEvent('error'));
    harness.detectChanges();
    expect(element().querySelector('form')).toBeNull();
    element().querySelector<HTMLButtonElement>('.state-message button')!.click();
    await harness.fixture.whenStable();
    get().flush(cart);
    harness.detectChanges();
    expect(element().querySelector<HTMLInputElement>('input')?.disabled).toBe(false);
  });

  it('rejects invalid quantity and cancels pending reads on logout', async () => {
    await loaded();
    const input = element().querySelector<HTMLInputElement>('input')!;
    input.value = '0';
    element()
      .querySelector('form')!
      .dispatchEvent(new Event('submit', { cancelable: true }));
    harness.detectChanges();
    expect(element().querySelector('.error-message')?.textContent).toContain('quantidade inteira');
    http.expectNone((req) => req.method === 'PATCH');
    element().querySelector<HTMLButtonElement>('.page-heading button')!.click();
    await harness.fixture.whenStable();
    const pending = get();
    auth.state.set({ status: 'anonymous' });
    await harness.fixture.whenStable();
    expect(pending.cancelled).toBe(true);
    expect(element().textContent).not.toContain('Subtotal');
    expect(element().querySelector('input')).toBeNull();
  });
});
