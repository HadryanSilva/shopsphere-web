import { TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { provideRouter, Router } from '@angular/router';
import { signal } from '@angular/core';
import { AuthService, AuthState } from '../auth/auth.service';
import { RouterTestingHarness } from '@angular/router/testing';
import { routes } from '../app.routes';
import { Product } from '../catalog/catalog-api';
import { ProductDetail } from './product-detail';

const product: Product = {
  id: '20000000-0000-0000-0000-000000000001',
  name: 'Candeeiro de mesa',
  description: 'Luz de leitura.\nBase ajustável.',
  categoryId: '10000000-0000-0000-0000-000000000001',
  price: 42.5,
  currency: 'EUR',
  imageUrl: 'https://example.invalid/lamp.jpg',
  status: 'ACTIVE',
  createdAt: '2026-10-27T00:00:00Z',
  updatedAt: '2026-10-27T00:00:00Z',
};
const secondId = '20000000-0000-0000-0000-000000000002';

describe('ProductDetail', () => {
  let harness: RouterTestingHarness;
  let http: HttpTestingController;
  const auth = {
    state: signal<AuthState>({ status: 'anonymous' }),
    actionPending: signal(false),
    login: vi.fn(),
    getAccessToken: vi.fn(async () => 'test-token'),
  };

  beforeEach(async () => {
    auth.state.set({ status: 'anonymous' });
    auth.actionPending.set(false);
    auth.login.mockClear();
    auth.getAccessToken.mockClear();
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
  function request(id = product.id) {
    return http.expectOne(`/api/v1/products/${id}`);
  }
  async function open(id = product.id, query = '') {
    await harness.navigateByUrl(`/products/${id}${query}`, ProductDetail);
  }

  it('loads a direct URL through the public Gateway path and renders product data', async () => {
    await open();
    expect(element().textContent).toContain('A carregar produto');
    const pending = request();
    expect(pending.request.method).toBe('GET');
    expect(pending.request.headers.has('Authorization')).toBe(false);
    pending.flush(product);
    harness.detectChanges();
    expect(element().querySelector('h1')?.textContent).toBe(product.name);
    expect(element().querySelector('.description')?.textContent?.trim()).toBe(product.description);
    expect(element().querySelector('.price')?.textContent?.replace(/\s/g, '')).toBe('42,50€');
    expect(element().querySelector('img')?.alt).toBe(product.name);
    expect(element().querySelector('[aria-busy]')?.getAttribute('aria-busy')).toBe('false');
    expect(element().textContent).not.toContain('Em estoque');
  });

  it('distinguishes a 404 from a temporary error and preserves the catalog return query', async () => {
    await open(product.id, '?name=Livro&minPrice=10&sort=price,asc&page=2');
    request().flush({}, { status: 404, statusText: 'Not Found' });
    harness.detectChanges();
    expect(element().querySelector('h1')?.textContent).toBe('Produto não encontrado');
    expect(element().querySelector('button')).toBeNull();
    const back = element().querySelector<HTMLAnchorElement>('.back-link')!;
    expect(back.getAttribute('href')).toBe(
      '/?name=Livro&minPrice=10&sort=price,asc&page=2#catalogo',
    );
    back.click();
    await harness.fixture.whenStable();
    const list = http.expectOne((req) => req.url === '/api/v1/products');
    expect(list.request.params.get('name')).toBe('Livro');
    expect(list.request.params.get('minPrice')).toBe('10');
    expect(list.request.params.get('page')).toBe('2');
    list.flush({
      content: [],
      page: 2,
      size: 20,
      totalElements: 0,
      totalPages: 0,
      first: false,
      last: true,
    });
  });

  it('handles an invalid UUID without calling the API or the batch endpoint', async () => {
    await open('batch');
    expect(element().textContent).toContain('Produto não encontrado');
    http.expectNone((req) => req.url.startsWith('/api/'));
  });

  it('retries temporary errors without exposing backend details', async () => {
    await open();
    request().flush(
      { detail: 'Internal backend details' },
      { status: 503, statusText: 'Unavailable' },
    );
    harness.detectChanges();
    expect(element().textContent).toContain('Não foi possível carregar');
    expect(element().textContent).not.toContain('Internal backend details');
    element().querySelector<HTMLButtonElement>('button')!.click();
    harness.detectChanges();
    expect(element().textContent).toContain('A carregar produto');
    request().flush(product);
    harness.detectChanges();
    expect(element().querySelector('h1')?.textContent).toBe(product.name);
    expect(element().querySelector('[role="alert"]')).toBeNull();
  });

  it('handles network failures as errors rather than missing products', async () => {
    await open();
    request().error(new ProgressEvent('error'));
    harness.detectChanges();
    expect(element().querySelector('[role="alert"]')).not.toBeNull();
    expect(element().textContent).not.toContain('Produto não encontrado');
  });

  it('uses fallbacks for a missing image and description, and renders text safely', async () => {
    await open();
    request().flush({ ...product, imageUrl: null, description: '  ' });
    harness.detectChanges();
    expect(element().querySelector('img')).toBeNull();
    expect(element().textContent).toContain('Imagem indisponível');
    expect(element().textContent).toContain('Descrição indisponível');
    await open(secondId);
    request(secondId).flush({ ...product, id: secondId, description: '<script>example</script>' });
    harness.detectChanges();
    expect(element().querySelector('.description')?.textContent?.trim()).toBe(
      '<script>example</script>',
    );
    expect(element().querySelector('script')).toBeNull();
  });

  it('validates quantity without sending cart requests', async () => {
    await open();
    request().flush(product);
    harness.detectChanges();
    const input = element().querySelector<HTMLInputElement>('#quantity')!;
    expect(input.value).toBe('1');
    for (const value of ['0', '-1', '1.5', '', '2147483648']) {
      input.value = value;
      input.dispatchEvent(new Event('input'));
      harness.detectChanges();
      expect(input.getAttribute('aria-invalid')).toBe('true');
    }
    input.value = '3';
    input.dispatchEvent(new Event('input'));
    harness.detectChanges();
    expect(input.getAttribute('aria-invalid')).toBeNull();
    expect(element().querySelector<HTMLButtonElement>('.purchase button')?.disabled).toBe(false);
    expect(element().textContent).toContain('Entrar para adicionar');
    http.expectNone((req) => req.url.includes('/carts'));
  });

  it.each(['INACTIVE', 'OUT_OF_STOCK'] as const)(
    'does not suggest purchase for a %s product',
    async (status) => {
      await open();
      request().flush({ ...product, status });
      harness.detectChanges();
      expect(element().querySelector<HTMLInputElement>('#quantity')?.disabled).toBe(true);
      expect(element().textContent).toContain('Este produto não está disponível para compra');
    },
  );

  it('resets image errors and quantity when the product changes', async () => {
    await open();
    request().flush(product);
    harness.detectChanges();
    element().querySelector('img')!.dispatchEvent(new Event('error'));
    const input = element().querySelector<HTMLInputElement>('#quantity')!;
    input.value = '4';
    input.dispatchEvent(new Event('input'));
    harness.detectChanges();
    expect(element().querySelector('img')).toBeNull();
    await open(secondId);
    request(secondId).flush({ ...product, id: secondId, name: 'Outro produto' });
    harness.detectChanges();
    expect(element().querySelector('img')).not.toBeNull();
    expect(element().querySelector<HTMLInputElement>('#quantity')?.value).toBe('1');
  });

  it('cancels stale requests on ID changes and when leaving the detail', async () => {
    await open();
    const stale = request();
    await open(secondId);
    expect(stale.cancelled).toBe(true);
    const current = request(secondId);
    await harness.navigateByUrl('/');
    expect(current.cancelled).toBe(true);
    http
      .expectOne((req) => req.url === '/api/v1/products')
      .flush({
        content: [],
        page: 0,
        size: 20,
        totalElements: 0,
        totalPages: 0,
        first: true,
        last: true,
      });
  });

  it('adds the selected quantity once with the user token and no client prices or identity', async () => {
    auth.state.set({ status: 'authenticated', username: 'Cliente' });
    await open();
    request().flush(product);
    harness.detectChanges();
    const quantity = element().querySelector<HTMLInputElement>('#quantity')!;
    quantity.value = '3';
    quantity.dispatchEvent(new Event('input'));
    harness.detectChanges();
    const add = element().querySelector<HTMLButtonElement>('.add-button')!;
    add.click();
    add.click();
    await harness.fixture.whenStable();
    const pending = http.expectOne('/api/v1/carts/me/items');
    expect(pending.request.method).toBe('POST');
    expect(pending.request.body).toEqual({ productId: product.id, quantity: 3 });
    expect(pending.request.headers.get('Authorization')).toBe('Bearer test-token');
    pending.flush({
      cartId: 'cart-id',
      productId: product.id,
      quantity: 3,
      message: 'Item added to cart',
    });
    harness.detectChanges();
    expect(element().textContent).toContain('Produto adicionado ao carrinho');
    expect(element().querySelector('.view-cart')?.getAttribute('href')).toBe('/cart');
  });

  it('requires consulting the cart after an ambiguous failure instead of repeating the POST', async () => {
    auth.state.set({ status: 'authenticated', username: 'Cliente' });
    await open();
    request().flush(product);
    harness.detectChanges();
    element().querySelector<HTMLButtonElement>('.add-button')!.click();
    await harness.fixture.whenStable();
    http.expectOne('/api/v1/carts/me/items').error(new ProgressEvent('error'));
    harness.detectChanges();
    expect(element().textContent).toContain('Não foi possível confirmar a alteração');
    const button = element().querySelector<HTMLButtonElement>('.add-button')!;
    expect(button.disabled).toBe(true);
    button.click();
    http.expectNone('/api/v1/carts/me/items');
    expect(element().querySelector('.view-cart')).not.toBeNull();
  });

  it('preserves quantity for login without automatically adding after authentication', async () => {
    await open(product.id, '?name=Livro&page=2');
    request().flush(product);
    harness.detectChanges();
    const input = element().querySelector<HTMLInputElement>('#quantity')!;
    input.value = '4';
    input.dispatchEvent(new Event('input'));
    harness.detectChanges();
    element().querySelector<HTMLButtonElement>('.purchase button')!.click();
    await harness.fixture.whenStable();
    expect(auth.login).toHaveBeenCalledOnce();
    const query = TestBed.inject(Router).parseUrl(TestBed.inject(Router).url).queryParams;
    expect(query).toEqual({ name: 'Livro', page: '2', quantity: '4' });
    auth.state.set({ status: 'authenticated', username: 'Cliente' });
    harness.detectChanges();
    http.expectNone((req) => req.url.includes('/carts'));
  });

  it('restores the quantity in a login return URL and cancels additions on logout', async () => {
    auth.state.set({ status: 'authenticated', username: 'Cliente' });
    await open(product.id, '?quantity=4');
    request().flush(product);
    harness.detectChanges();
    expect(element().querySelector<HTMLInputElement>('#quantity')?.value).toBe('4');
    element().querySelector<HTMLButtonElement>('.add-button')!.click();
    await harness.fixture.whenStable();
    const pending = http.expectOne('/api/v1/carts/me/items');
    auth.state.set({ status: 'anonymous' });
    await harness.fixture.whenStable();
    expect(pending.cancelled).toBe(true);
  });

  it('opens a card from a filtered catalog without losing the return query', async () => {
    await harness.navigateByUrl('/?name=Candeeiro&sort=price,asc&page=2');
    http
      .expectOne((req) => req.url === '/api/v1/products')
      .flush({
        content: [product],
        page: 2,
        size: 20,
        totalElements: 41,
        totalPages: 3,
        first: false,
        last: true,
      });
    harness.detectChanges();
    expect(element().querySelector('.catalog-link')?.getAttribute('href')).toBe(
      '/?name=Candeeiro&sort=price,asc&page=2#catalogo',
    );
    element().querySelector<HTMLAnchorElement>('.product-link')!.click();
    await harness.fixture.whenStable();
    request().flush(product);
    harness.detectChanges();
    expect(element().querySelector('h1')?.textContent).toBe(product.name);
    expect(element().querySelector('.back-link')?.getAttribute('href')).toBe(
      '/?name=Candeeiro&sort=price,asc&page=2#catalogo',
    );
    expect(element().querySelector('#catalogo')).toBeNull();
  });
});
