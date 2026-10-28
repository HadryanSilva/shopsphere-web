import { TestBed } from '@angular/core/testing';
import { App } from './app';
import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting, HttpTestingController } from '@angular/common/http/testing';
import { provideRouter, Router } from '@angular/router';
import { routes } from './app.routes';
import { signal } from '@angular/core';
import { AuthService, AuthState } from './auth/auth.service';

describe('App', () => {
  const auth = {
    state: signal<AuthState>({ status: 'anonymous' }),
    error: signal(''),
    actionPending: signal(false),
    login: vi.fn(),
    logout: vi.fn(),
    initialize: vi.fn(),
  };
  beforeEach(async () => {
    auth.state.set({ status: 'anonymous' });
    auth.error.set('');
    auth.actionPending.set(false);
    auth.login.mockClear();
    auth.logout.mockClear();
    auth.initialize.mockClear();
    await TestBed.configureTestingModule({
      imports: [App],
      providers: [
        provideHttpClient(),
        provideHttpClientTesting(),
        provideRouter(routes),
        { provide: AuthService, useValue: auth },
      ],
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
    expect(buttons.length).toBe(1);
    expect(buttons[0].disabled).toBe(false);
    expect(buttons[0].getAttribute('aria-label')).toBe('Entrar na conta');
    expect(compiled.querySelector('[aria-label="Carrinho"]')?.getAttribute('href')).toBe('/cart');
  });

  it('offers login, shows the account name and logout and links to the cart', async () => {
    const fixture = TestBed.createComponent(App);
    await fixture.whenStable();
    const compiled = fixture.nativeElement as HTMLElement;
    compiled.querySelector<HTMLButtonElement>('[aria-label="Entrar na conta"]')!.click();
    expect(auth.login).toHaveBeenCalledOnce();
    auth.state.set({ status: 'authenticated', username: 'Cliente' });
    fixture.detectChanges();
    expect(compiled.querySelector('.account-name')?.textContent).toBe('Cliente');
    expect(compiled.querySelector('[aria-label="Entrar na conta"]')).toBeNull();
    compiled.querySelector<HTMLButtonElement>('[aria-label="Terminar sessão"]')!.click();
    expect(auth.logout).toHaveBeenCalledOnce();
    expect(compiled.querySelector('[aria-label="Carrinho"]')?.getAttribute('href')).toBe('/cart');
  });

  it('allows public navigation and authentication recovery when Keycloak is unavailable', async () => {
    auth.state.set({ status: 'unavailable' });
    auth.error.set('Não foi possível verificar a sessão.');
    const fixture = TestBed.createComponent(App);
    fixture.detectChanges();
    const compiled = fixture.nativeElement as HTMLElement;
    expect(compiled.querySelector('[role="alert"]')?.textContent).toContain('verificar a sessão');
    expect(compiled.querySelector('input[type="search"]')).not.toBeNull();
    expect(
      compiled.querySelector<HTMLButtonElement>('[aria-label="Entrar na conta"]')?.disabled,
    ).toBe(true);
    compiled.querySelector<HTMLButtonElement>('.auth-message button')!.click();
    expect(auth.initialize).toHaveBeenCalledOnce();
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
