import { TestBed, ComponentFixture } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { Catalog } from './catalog';
import { Product, ProductPage } from './catalog-api';

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

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [Catalog],
      providers: [provideHttpClient(), provideHttpClientTesting()],
    }).compileComponents();
    http = TestBed.inject(HttpTestingController);
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
    expect(element.querySelector('.result-count')?.textContent).toContain('1 de 24');
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
    expect(element.querySelector('button')).toBeNull();
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
    element.querySelector('button')!.click();
    fixture.detectChanges();
    expect(element.textContent).toContain('A carregar produtos');
    expect(element.querySelector('button')).toBeNull();
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
});
