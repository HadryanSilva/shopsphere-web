import { TestBed } from '@angular/core/testing';
import { App } from './app';
import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting, HttpTestingController } from '@angular/common/http/testing';
import { provideRouter, Router } from '@angular/router';
import { routes } from './app.routes';

describe('App', () => {
  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [App],
      providers: [provideHttpClient(), provideHttpClientTesting(), provideRouter(routes)],
    }).compileComponents();
  });

  afterEach(() => {
    const http = TestBed.inject(HttpTestingController);
    http
      .match((request) => request.url === '/api/v1/products')
      .filter((request) => !request.cancelled)
      .forEach((request) => {
        request.flush({
          content: [],
          page: 0,
          size: 20,
          totalElements: 0,
          totalPages: 0,
          first: true,
          last: true,
        });
      });
    http.verify();
  });

  it('should create the app', () => {
    const fixture = TestBed.createComponent(App);
    const app = fixture.componentInstance;
    expect(app).toBeTruthy();
  });

  it('should provide a skip link targeting the main content', async () => {
    const fixture = TestBed.createComponent(App);
    await fixture.whenStable();
    const compiled = fixture.nativeElement as HTMLElement;
    const skipLink = compiled.querySelector<HTMLAnchorElement>('.skip-link');
    expect(skipLink?.getAttribute('href')).toBe('/#conteudo');
    expect(compiled.querySelector('main#conteudo')?.getAttribute('tabindex')).toBe('-1');
  });

  it('should keep features unavailable until their integrations exist', async () => {
    const fixture = TestBed.createComponent(App);
    await fixture.whenStable();
    const compiled = fixture.nativeElement as HTMLElement;
    expect(compiled.querySelector<HTMLInputElement>('input[type="search"]')?.disabled).toBe(false);
    const buttons = compiled.querySelectorAll<HTMLButtonElement>('.account-nav button');
    expect(buttons.length).toBe(2);
    for (const button of buttons) {
      expect(button.disabled).toBe(true);
      expect(button.getAttribute('aria-label')).toBeTruthy();
      expect(button.getAttribute('aria-describedby')).toBe('features-note');
    }
    expect(compiled.querySelector('#features-note')?.textContent).toContain('próximas etapas');
  });

  it('searches from the header, preserves price filters and resets the page', async () => {
    const router = TestBed.inject(Router);
    await router.navigateByUrl('/?page=3&minPrice=10');
    const fixture = TestBed.createComponent(App);
    fixture.detectChanges();
    const compiled = fixture.nativeElement as HTMLElement;
    const input = compiled.querySelector<HTMLInputElement>('input[type="search"]')!;
    input.value = '  Candeeiro  ';
    compiled
      .querySelector('form[role="search"]')!
      .dispatchEvent(new Event('submit', { cancelable: true }));
    await fixture.whenStable();
    expect(router.parseUrl(router.url).queryParams).toEqual({ minPrice: '10', name: 'Candeeiro' });
    expect(router.parseUrl(router.url).fragment).toBe('catalogo');
    await router.navigateByUrl('/?name=Livro');
    fixture.detectChanges();
    expect(input.value).toBe('Livro');
  });

  it('shows only the detail page and sends header searches back to the catalog', async () => {
    const router = TestBed.inject(Router);
    const http = TestBed.inject(HttpTestingController);
    const fixture = TestBed.createComponent(App);
    fixture.detectChanges();
    const id = '20000000-0000-0000-0000-000000000001';
    await router.navigateByUrl(`/products/${id}?minPrice=10&page=2`);
    http.expectOne(`/api/v1/products/${id}`).flush({
      id,
      name: 'Livro',
      description: 'Leitura',
      price: 12,
      currency: 'EUR',
      imageUrl: null,
      status: 'ACTIVE',
    });
    fixture.detectChanges();
    const compiled = fixture.nativeElement as HTMLElement;
    expect(compiled.querySelectorAll('h1').length).toBe(1);
    expect(compiled.querySelector('h1')?.textContent).toBe('Livro');
    expect(compiled.querySelector('#catalogo')).toBeNull();
    expect(compiled.querySelector('.skip-link')?.getAttribute('href')).toBe(
      `/products/${id}?minPrice=10&page=2#conteudo`,
    );
    expect(compiled.querySelector('footer a:last-child')?.getAttribute('href')).toBe(
      `/products/${id}?minPrice=10&page=2#conteudo`,
    );
    const input = compiled.querySelector<HTMLInputElement>('input[type="search"]')!;
    input.value = 'Candeeiro';
    compiled
      .querySelector('form[role="search"]')!
      .dispatchEvent(new Event('submit', { cancelable: true }));
    await fixture.whenStable();
    expect(router.url).toBe('/?minPrice=10&name=Candeeiro#catalogo');
    fixture.detectChanges();
    expect(compiled.querySelector('#catalogo')).not.toBeNull();
    expect(compiled.querySelector('#product-title')).toBeNull();
  });
});
