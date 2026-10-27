import { DOCUMENT } from '@angular/common';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import Keycloak, { KeycloakTokenParsed } from 'keycloak-js';
import { AuthService, KEYCLOAK_FACTORY } from './auth.service';

const config = { url: 'http://localhost:8180', realm: 'shopsphere', clientId: 'shopsphere-web' };

describe('AuthService', () => {
  let auth: AuthService;
  let http: HttpTestingController;
  let document: Document;
  let originalUrl: string;
  let client: ReturnType<typeof mockClient>;
  let factory: ReturnType<typeof vi.fn>;

  function mockClient() {
    const mock = {
      authenticated: false,
      token: undefined as string | undefined,
      tokenParsed: undefined as KeycloakTokenParsed | undefined,
      onAuthSuccess: undefined as (() => void) | undefined,
      onAuthRefreshSuccess: undefined as (() => void) | undefined,
      onAuthLogout: undefined as (() => void) | undefined,
      onTokenExpired: undefined as (() => void) | undefined,
      init: vi.fn(async () => mock.authenticated),
      login: vi.fn(async (_options: unknown) => {}),
      logout: vi.fn(async (_options: unknown) => {}),
      updateToken: vi.fn(async (_seconds: number) => false),
      clearToken: vi.fn(async () => {
        mock.authenticated = false;
        mock.token = undefined;
        mock.tokenParsed = undefined;
        mock.onAuthLogout?.();
      }),
    };
    return mock;
  }

  beforeEach(() => {
    client = mockClient();
    factory = vi.fn(() => client as unknown as Keycloak);
    TestBed.configureTestingModule({
      providers: [
        provideHttpClient(),
        provideHttpClientTesting(),
        { provide: KEYCLOAK_FACTORY, useValue: factory },
      ],
    });
    auth = TestBed.inject(AuthService);
    http = TestBed.inject(HttpTestingController);
    document = TestBed.inject(DOCUMENT);
    originalUrl = document.location.href;
  });

  afterEach(() => {
    http.verify();
    document.defaultView!.history.replaceState(null, '', originalUrl);
    vi.restoreAllMocks();
  });

  async function initialize() {
    const pending = auth.initialize();
    http.expectOne('/auth-config.json').flush(config);
    await pending;
  }

  it('uses the official adapter with code flow, PKCE, nonce and non-blocking SSO fallback', async () => {
    const pending = auth.initialize();
    expect(client.init).not.toHaveBeenCalled();
    expect(auth.state().status).toBe('initializing');
    expect(auth.initialize()).toBe(pending);
    http.expectOne('/auth-config.json').flush(config);
    await pending;
    expect(factory).toHaveBeenCalledWith(config);
    expect(client.init).toHaveBeenCalledWith(
      expect.objectContaining({
        flow: 'standard',
        pkceMethod: 'S256',
        useNonce: true,
        responseMode: 'query',
        onLoad: 'check-sso',
        silentCheckSsoFallback: false,
        checkLoginIframe: false,
        silentCheckSsoRedirectUri: `${document.location.origin}/silent-check-sso.html`,
      }),
    );
    expect(auth.state().status).toBe('anonymous');
  });

  it('restores the authenticated identity without persisting tokens', async () => {
    const storageWrite = vi.spyOn(Storage.prototype, 'setItem');
    client.authenticated = true;
    client.token = 'test-access-token';
    client.tokenParsed = { preferred_username: 'Cliente' };
    await initialize();
    expect(auth.state()).toEqual({ status: 'authenticated', username: 'Cliente' });
    expect(storageWrite).not.toHaveBeenCalled();
    await auth.initialize();
    expect(factory).toHaveBeenCalledOnce();
  });

  it('preserves the current same-origin path, filters and fragment for login and logout', async () => {
    document.defaultView!.history.replaceState(
      null,
      '',
      '/products/20000000-0000-0000-0000-000000000001?name=Livro&page=2#conteudo',
    );
    await initialize();
    await auth.login();
    expect(client.login).toHaveBeenCalledWith({ redirectUri: document.location.href });
    client.authenticated = true;
    client.tokenParsed = { preferred_username: 'Cliente' };
    client.onAuthSuccess?.();
    await auth.logout();
    expect(client.logout).toHaveBeenCalledWith({ redirectUri: document.location.href });
  });

  it('never accepts a return URL from query parameters', async () => {
    document.defaultView!.history.replaceState(
      null,
      '',
      '/?returnUrl=https://example.invalid&code=old-code&state=old-state&name=Livro',
    );
    await initialize();
    await auth.login();
    const target = new URL((client.login.mock.calls[0][0] as { redirectUri: string }).redirectUri);
    expect(target.origin).toBe(document.location.origin);
    expect(target.searchParams.get('name')).toBe('Livro');
    expect(target.searchParams.has('code')).toBe(false);
    expect(target.searchParams.has('state')).toBe(false);
  });

  it('keeps the public application available and allows recovery after config failure', async () => {
    const pending = auth.initialize();
    http.expectOne('/auth-config.json').flush({}, { status: 503, statusText: 'Unavailable' });
    await pending;
    expect(auth.state().status).toBe('unavailable');
    expect(auth.error()).toContain('continuar a explorar');
    await initialize();
    expect(auth.state().status).toBe('anonymous');
    expect(auth.error()).toBe('');
  });

  it('cleans OAuth callback data after init failure while preserving the shopping query', async () => {
    document.defaultView!.history.replaceState(
      null,
      '',
      '/?code=test-code&state=test-state&error=access_denied&name=Livro#catalogo',
    );
    client.init.mockRejectedValue(new Error('Internal identity provider details'));
    await initialize();
    expect(auth.state().status).toBe('unavailable');
    expect(auth.error()).not.toContain('Internal identity');
    expect(document.location.search).toBe('?name=Livro');
    expect(document.location.hash).toBe('#catalogo');
    expect(client.clearToken).toHaveBeenCalledOnce();
  });

  it('rejects an insecure remote identity provider before initializing the adapter', async () => {
    const pending = auth.initialize();
    http.expectOne('/auth-config.json').flush({ ...config, url: 'http://example.invalid' });
    await pending;
    expect(factory).not.toHaveBeenCalled();
    expect(auth.state().status).toBe('unavailable');
  });

  it('reports login and logout failures without exposing details or claiming a logout', async () => {
    await initialize();
    client.login.mockRejectedValue(new Error('Internal details'));
    await auth.login();
    expect(auth.error()).toBe('Não foi possível iniciar a sessão. Tente novamente.');
    expect(auth.actionPending()).toBe(false);
    client.authenticated = true;
    client.onAuthSuccess?.();
    client.logout.mockRejectedValue(new Error('Internal details'));
    await auth.logout();
    expect(auth.state().status).toBe('authenticated');
    expect(auth.error()).toBe('Não foi possível terminar a sessão. Tente novamente.');
  });

  it('prevents duplicate login actions while a redirect is being prepared', async () => {
    await initialize();
    let finish!: () => void;
    client.login.mockImplementation(
      () =>
        new Promise<void>((resolve) => {
          finish = resolve;
        }),
    );
    const login = auth.login();
    await auth.login();
    expect(client.login).toHaveBeenCalledOnce();
    expect(auth.actionPending()).toBe(true);
    finish();
    await login;
    expect(auth.actionPending()).toBe(false);
  });

  it('refreshes an expired token and updates the displayed identity', async () => {
    client.authenticated = true;
    await initialize();
    client.tokenParsed = { preferred_username: 'Cliente atualizado' };
    client.onTokenExpired?.();
    await vi.waitFor(() =>
      expect(auth.state()).toEqual({ status: 'authenticated', username: 'Cliente atualizado' }),
    );
    expect(client.updateToken).toHaveBeenCalledWith(30);
  });

  it('clears expired credentials after refresh failure and offers login again', async () => {
    client.authenticated = true;
    client.token = 'test-token';
    await initialize();
    client.updateToken.mockRejectedValue(new Error('Invalid refresh token'));
    client.onTokenExpired?.();
    await vi.waitFor(() => expect(auth.state().status).toBe('anonymous'));
    expect(client.token).toBeUndefined();
    expect(auth.error()).toContain('sessão terminou');
    await auth.login();
    expect(client.login).toHaveBeenCalledOnce();
  });
});
