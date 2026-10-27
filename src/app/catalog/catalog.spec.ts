import { TestBed, ComponentFixture } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { Catalog } from './catalog';
import { Product, ProductPage } from './catalog-api';
import { NavigationEnd, provideRouter, Router } from '@angular/router';
import { filter, firstValueFrom } from 'rxjs';
import { Location } from '@angular/common';
import { provideLocationMocks } from '@angular/common/testing';

const product: Product = {
  id: '20000000-0000-0000-0000-000000000001',
  name: 'Candeeiro de mesa',
  description: 'Luz de leitura',
  categoryId: '10000000-0000-0000-0000-000000000001',
  price: 42.5,
  currency: 'EUR',
  imageUrl: 'https://example.invalid/lamp.jpg',
  status: 'ACTIVE',
  createdAt: '2026-10-27T00:00:00Z',
  updatedAt: '2026-10-27T00:00:00Z',
};

function page(content: Product[], totalElements = content.length): ProductPage {
  return {
    content,
    page: 0,
    size: 20,
    totalElements,
    totalPages: Math.ceil(totalElements / 20),
    first: true,
    last: totalElements <= 20,
  };
}

describe('Catalog', () => {
  let fixture: ComponentFixture<Catalog>;
  let http: HttpTestingController;
  let element: HTMLElement;
  let router: Router;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [Catalog],
      providers: [
        provideHttpClient(),
        provideHttpClientTesting(),
        provideRouter([]),
        provideLocationMocks(),
      ],
    }).compileComponents();
    http = TestBed.inject(HttpTestingController);
    router = TestBed.inject(Router);
    router.setUpLocationChangeListener();
    await router.navigateByUrl('/');
    fixture = TestBed.createComponent(Catalog);
    element = fixture.nativeElement;
    fixture.detectChanges();
  });

  afterEach(() => http.verify());

  function request() {
    return http.expectOne((req) => req.url === '/api/v1/products');
  }

  it('loads the first active page through the relative Gateway path', () => {
    expect(element.textContent).toContain('A carregar produtos');
    expect(element.querySelector('[aria-busy]')?.getAttribute('aria-busy')).toBe('true');
    const pending = request();
    expect(pending.request.method).toBe('GET');
    expect(pending.request.params.get('page')).toBe('0');
    expect(pending.request.params.get('size')).toBe('20');
    expect(pending.request.params.get('sort')).toBe('name,asc');
    expect(pending.request.params.get('status')).toBe('ACTIVE');
    expect(pending.request.headers.has('Authorization')).toBe(false);
    pending.flush(page([product], 24));
    fixture.detectChanges();
    expect(element.querySelector('h3')?.textContent).toBe(product.name);
    expect(element.querySelector('.price')?.textContent?.replace(/\s/g, '')).toBe('42,50€');
    expect(element.querySelector('.result-count')?.textContent).toContain('1–1 de 24');
    expect(element.querySelector('.product-link')?.getAttribute('href')).toBe(
      `/products/${product.id}`,
    );
    const image = element.querySelector('img');
    expect(image?.getAttribute('src')).toBe(product.imageUrl);
    expect(image?.alt).toBe(product.name);
    expect(element.querySelector('[aria-busy]')?.getAttribute('aria-busy')).toBe('false');
  });

  it('shows an empty state only after a successful empty response', () => {
    request().flush(page([]));
    fixture.detectChanges();
    expect(element.textContent).toContain('Ainda não há produtos');
    expect(element.querySelector('.product-card')).toBeNull();
    expect(element.querySelector('.state-message button')).toBeNull();
  });

  it('retries after an HTTP failure and clears the error on success', () => {
    request().flush(
      { detail: 'Internal backend details' },
      { status: 503, statusText: 'Unavailable' },
    );
    fixture.detectChanges();
    expect(element.querySelector('[role="alert"]')?.textContent).toContain('Não foi possível');
    expect(element.textContent).not.toContain('Internal backend details');
    expect(element.textContent).not.toContain('Ainda não há produtos');
    element.querySelector<HTMLButtonElement>('.state-message button')!.click();
    fixture.detectChanges();
    expect(element.textContent).toContain('A carregar produtos');
    expect(element.querySelector('.state-message button')).toBeNull();
    request().flush(page([product]));
    fixture.detectChanges();
    expect(element.querySelector('[role="alert"]')).toBeNull();
    expect(element.querySelectorAll('.product-card').length).toBe(1);
  });

  it('handles a network failure without presenting an empty catalog', () => {
    request().error(new ProgressEvent('error'));
    fixture.detectChanges();
    expect(element.querySelector('[role="alert"]')).not.toBeNull();
    expect(element.textContent).not.toContain('Ainda não há produtos');
  });

  it('uses a text fallback for missing and broken images', () => {
    request().flush(page([product, { ...product, id: 'other', imageUrl: null }]));
    fixture.detectChanges();
    expect(element.querySelectorAll('.image-placeholder').length).toBe(1);
    element.querySelector('img')!.dispatchEvent(new Event('error'));
    fixture.detectChanges();
    expect(element.querySelector('img')).toBeNull();
    expect(element.querySelectorAll('.image-placeholder').length).toBe(2);
  });

  it('cancels a pending request when leaving the component', () => {
    const pending = request();
    fixture.destroy();
    expect(pending.cancelled).toBe(true);
  });

  it('restores filters and page from the URL and forwards only supported parameters', async () => {
    request().flush(page([]));
    await router.navigateByUrl(
      '/?name=Livro&minPrice=10.50&maxPrice=100&sort=price,desc&page=2&status=INACTIVE&size=999',
    );
    fixture.detectChanges();
    const pending = request();
    expect(pending.request.params.get('name')).toBe('Livro');
    expect(pending.request.params.get('minPrice')).toBe('10.50');
    expect(pending.request.params.get('maxPrice')).toBe('100');
    expect(pending.request.params.get('sort')).toBe('price,desc');
    expect(pending.request.params.get('page')).toBe('2');
    expect(pending.request.params.get('status')).toBe('ACTIVE');
    expect(pending.request.params.get('size')).toBe('20');
    pending.flush({ ...page([product], 45), page: 2, first: false, last: true });
    fixture.detectChanges();
    expect(element.querySelector<HTMLInputElement>('#min-price')?.value).toBe('10.50');
    expect(element.querySelector<HTMLSelectElement>('#catalog-sort')?.value).toBe('price,desc');
    expect(element.querySelector('.result-count')?.textContent).toContain('41–41 de 45');
    expect(element.querySelectorAll<HTMLButtonElement>('.pagination button')[1].disabled).toBe(
      true,
    );
  });

  it('applies comma decimal prices, preserves search and resets pagination', async () => {
    request().flush(page([]));
    await router.navigateByUrl('/?name=Livro&page=2');
    request().flush({ ...page([]), page: 2 });
    fixture.detectChanges();
    setPrice('#min-price', '12,50');
    setPrice('#max-price', '50');
    element.querySelector('form')!.dispatchEvent(new Event('submit', { cancelable: true }));
    await fixture.whenStable();
    const pending = request();
    expect(pending.request.params.get('page')).toBe('0');
    expect(pending.request.params.get('name')).toBe('Livro');
    expect(pending.request.params.get('minPrice')).toBe('12.50');
    expect(router.parseUrl(router.url).queryParams['minPrice']).toBe('12.50');
    pending.flush(page([product]));
  });

  it('does not request invalid price ranges from the form or URL', async () => {
    request().flush(page([]));
    setPrice('#min-price', '100');
    setPrice('#max-price', '10');
    element.querySelector('form')!.dispatchEvent(new Event('submit', { cancelable: true }));
    fixture.detectChanges();
    expect(element.querySelector('#price-error')?.textContent).toContain('maior');
    http.expectNone((req) => req.url === '/api/v1/products');
    await router.navigateByUrl('/?minPrice=-10');
    fixture.detectChanges();
    expect(element.querySelector('.state-message[role="alert"]')?.textContent).toContain(
      'preços positivos',
    );
    http.expectNone((req) => req.url === '/api/v1/products');
  });

  it('resets invalid pages and unsupported sorting to safe defaults', async () => {
    request().flush(page([]));
    await router.navigateByUrl('/?name=Livro&page=-1&sort=unsupported,desc');
    const pending = request();
    expect(pending.request.params.get('page')).toBe('0');
    expect(pending.request.params.get('sort')).toBe('name,asc');
    pending.flush(page([]));
  });

  it('paginates with current filters, changes sorting and restores browser history', async () => {
    request().flush(page([]));
    await router.navigateByUrl('/?name=Livro&minPrice=0');
    request().flush(page([product], 21));
    fixture.detectChanges();
    const buttons = element.querySelectorAll<HTMLButtonElement>('.pagination button');
    expect(buttons[0].disabled).toBe(true);
    buttons[1].click();
    await fixture.whenStable();
    const next = request();
    expect(next.request.params.get('page')).toBe('1');
    expect(next.request.params.get('minPrice')).toBe('0');
    next.flush({ ...page([product], 21), page: 1, first: false, last: true });
    fixture.detectChanges();
    const select = element.querySelector<HTMLSelectElement>('#catalog-sort')!;
    select.value = 'createdAt,desc';
    select.dispatchEvent(new Event('change'));
    await fixture.whenStable();
    const sorted = request();
    expect(sorted.request.params.get('page')).toBe('0');
    expect(sorted.request.params.get('sort')).toBe('createdAt,desc');
    sorted.flush(page([product], 21));
    const navigation = firstValueFrom(
      router.events.pipe(filter((event) => event instanceof NavigationEnd)),
    );
    TestBed.inject(Location).back();
    await navigation;
    await fixture.whenStable();
    const restored = request();
    expect(restored.request.params.get('page')).toBe('1');
    expect(restored.request.params.get('sort')).toBe('name,asc');
    restored.flush({ ...page([product], 21), page: 1, first: false, last: true });
  });

  it('cancels stale searches and retries using the current filters', async () => {
    const stale = request();
    await router.navigateByUrl('/?name=Novo');
    expect(stale.cancelled).toBe(true);
    request().flush({}, { status: 503, statusText: 'Unavailable' });
    fixture.detectChanges();
    element.querySelector<HTMLButtonElement>('.state-message button')!.click();
    const retry = request();
    expect(retry.request.params.get('name')).toBe('Novo');
    retry.flush(page([product]));
  });

  it('removes active filters without losing sorting', async () => {
    request().flush(page([]));
    await router.navigateByUrl('/?name=Livro&minPrice=20&sort=price,asc&page=2');
    request().flush({ ...page([]), page: 2 });
    fixture.detectChanges();
    element.querySelector<HTMLButtonElement>('.active-filters button')!.click();
    await fixture.whenStable();
    const pending = request();
    expect(pending.request.params.has('name')).toBe(false);
    expect(pending.request.params.get('minPrice')).toBe('20');
    expect(pending.request.params.get('sort')).toBe('price,asc');
    expect(pending.request.params.get('page')).toBe('0');
    pending.flush(page([]));
  });

  it('opens the mobile filter panel with an accessible disclosure', () => {
    request().flush(page([]));
    const toggle = element.querySelector<HTMLButtonElement>('.filter-toggle')!;
    expect(toggle.getAttribute('aria-expanded')).toBe('false');
    toggle.click();
    fixture.detectChanges();
    expect(toggle.getAttribute('aria-expanded')).toBe('true');
    expect(element.querySelector('#price-filters')?.classList.contains('is-open')).toBe(true);
  });

  it('clears invalid draft prices even when the URL has no filters', async () => {
    request().flush(page([]));
    setPrice('#min-price', '100');
    setPrice('#max-price', '10');
    element.querySelector('form')!.dispatchEvent(new Event('submit', { cancelable: true }));
    fixture.detectChanges();
    expect(element.querySelector('#price-error')?.textContent).toContain('maior');
    element.querySelector<HTMLButtonElement>('form button.secondary')!.click();
    await fixture.whenStable();
    expect(element.querySelector<HTMLInputElement>('#min-price')?.value).toBe('');
    expect(element.querySelector<HTMLInputElement>('#max-price')?.value).toBe('');
    expect(element.querySelector('#price-error')?.textContent?.trim()).toBe('');
    http.expectNone((req) => req.url === '/api/v1/products');
  });

  it('offers a way back from a page that no longer has products', async () => {
    request().flush(page([]));
    await router.navigateByUrl('/?name=Livro&page=99');
    request().flush({ ...page([], 2), page: 99, first: false });
    fixture.detectChanges();
    expect(element.querySelector('.state-message')?.textContent).toContain(
      'Esta página não tem produtos',
    );
    element.querySelector<HTMLButtonElement>('.state-message button')!.click();
    await fixture.whenStable();
    const first = request();
    expect(first.request.params.get('page')).toBe('0');
    expect(first.request.params.get('name')).toBe('Livro');
    first.flush(page([product], 2));
  });

  it('rejects reversed price bounds without losing cent precision on large values', () => {
    request().flush(page([]));
    setPrice('#min-price', '10000000000000000.02');
    setPrice('#max-price', '10000000000000000.01');
    element.querySelector('form')!.dispatchEvent(new Event('submit', { cancelable: true }));
    fixture.detectChanges();
    expect(element.querySelector('#price-error')?.textContent).toContain('maior');
    http.expectNone((req) => req.url === '/api/v1/products');
  });

  function setPrice(selector: string, value: string) {
    const input = element.querySelector<HTMLInputElement>(selector)!;
    input.value = value;
    input.dispatchEvent(new Event('input'));
  }
});
