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

  it('exposes a stable subject across refresh and distinguishes accounts with the same name', async () => {
    const storageWrite = vi.spyOn(Storage.prototype, 'setItem');
    client.authenticated = true;
    client.token = 'test-token';
    client.tokenParsed = { sub: 'account-one', preferred_username: 'Cliente' };
    await initialize();
    expect(auth.subject()).toBe('account-one');
    client.token = 'refreshed-token';
    client.onAuthRefreshSuccess?.();
    expect(auth.subject()).toBe('account-one');
    client.tokenParsed = { sub: 'account-two', preferred_username: 'Cliente' };
    client.onAuthSuccess?.();
    expect(auth.subject()).toBe('account-two');
    client.onAuthLogout?.();
    expect(auth.subject()).toBeUndefined();
    expect(storageWrite).not.toHaveBeenCalled();
  });

  it('does not expose a subject for an anonymous session, missing claim or refresh failure', async () => {
    expect(auth.subject()).toBeUndefined();
    await initialize();
    expect(auth.subject()).toBeUndefined();
    client.authenticated = true;
    client.onAuthSuccess?.();
    expect(auth.subject()).toBeUndefined();
    client.tokenParsed = { sub: 'account-one' };
    client.onAuthSuccess?.();
    expect(auth.subject()).toBe('account-one');
    client.updateToken.mockRejectedValue(new Error('Expired'));
    await auth.getAccessToken();
    expect(auth.subject()).toBeUndefined();
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

  it('keeps the subject stable when the display name and access token change', async () => {
    client.authenticated = true;
    client.tokenParsed = { sub: 'account-one', preferred_username: 'Nome inicial' };
    await initialize();
    client.updateToken.mockImplementation(async () => {
      client.token = 'renewed-token';
      client.tokenParsed = { sub: 'account-one', preferred_username: 'Nome atualizado' };
      client.onAuthRefreshSuccess?.();
      return true;
    });
    expect(await auth.getAccessToken()).toBe('renewed-token');
    expect(auth.subject()).toBe('account-one');
    expect(auth.state()).toEqual({ status: 'authenticated', username: 'Nome atualizado' });
    expect(auth.state()).not.toHaveProperty('token');
  });

  it.each([undefined, '', '   ', 42])(
    'does not substitute a username for an invalid subject %s',
    async (sub) => {
      client.authenticated = true;
      client.tokenParsed = { preferred_username: 'Cliente', sub } as KeycloakTokenParsed;
      await initialize();
      expect(auth.subject()).toBeUndefined();
      expect(auth.state()).toEqual({ status: 'authenticated', username: 'Cliente' });
    },
  );

  it('restores the same account only after reauthentication completes and preserves its order URL', async () => {
    document.defaultView!.history.replaceState(
      null,
      '',
      '/orders/20000000-0000-0000-0000-000000000001?view=detail#conteudo',
    );
    client.authenticated = true;
    client.tokenParsed = { sub: 'account-one', preferred_username: 'Cliente' };
    await initialize();
    client.updateToken.mockRejectedValueOnce(new Error('Expired'));
    expect(await auth.getAccessToken()).toBeUndefined();
    expect(auth.subject()).toBeUndefined();
    await auth.login();
    expect(auth.subject()).toBeUndefined();
    expect(client.login).toHaveBeenCalledWith({ redirectUri: document.location.href });
    client.authenticated = true;
    client.tokenParsed = { sub: 'account-one', preferred_username: 'Outro nome' };
    client.onAuthSuccess?.();
    expect(auth.subject()).toBe('account-one');
  });

  it('keeps the current identity if logout fails and clears it when logout is reported', async () => {
    client.authenticated = true;
    client.tokenParsed = { sub: 'account-one' };
    await initialize();
    client.logout.mockRejectedValueOnce(new Error('Unavailable'));
    await auth.logout();
    expect(auth.subject()).toBe('account-one');
    client.logout.mockImplementation(async () => {
      await client.clearToken();
    });
    await auth.logout();
    expect(auth.subject()).toBeUndefined();
    expect(auth.state().status).toBe('anonymous');
  });

  it('notifies explicit logout before redirect even if the provider rejects it', async () => {
    client.authenticated = true;
    client.tokenParsed = { sub: 'account-one' };
    await initialize();
    const cleanup = vi.fn();
    const subscription = auth.explicitLogout.subscribe(cleanup);
    client.logout.mockImplementation(async () => {
      expect(cleanup).toHaveBeenCalledOnce();
      throw new Error('Unavailable');
    });
    await auth.logout();
    expect(cleanup).toHaveBeenCalledOnce();
    expect(auth.state().status).toBe('authenticated');
    subscription.unsubscribe();
  });

  it('does not report technical expiration, unsolicited logout or anonymous logout as explicit logout', async () => {
    const cleanup = vi.fn();
    const subscription = auth.explicitLogout.subscribe(cleanup);
    await initialize();
    await auth.logout();
    client.authenticated = true;
    client.tokenParsed = { sub: 'account-one' };
    client.onAuthSuccess?.();
    client.updateToken.mockRejectedValueOnce(new Error('Expired'));
    await auth.getAccessToken();
    expect(auth.subject()).toBeUndefined();
    client.onAuthLogout?.();
    expect(cleanup).not.toHaveBeenCalled();
    subscription.unsubscribe();
  });

  it('does not return another account token when the subject changes during refresh', async () => {
    client.authenticated = true;
    client.token = 'account-one-token';
    client.tokenParsed = { sub: 'account-one' };
    await initialize();
    let finish!: (value: boolean) => void;
    client.updateToken.mockReturnValueOnce(
      new Promise((resolve) => {
        finish = resolve;
      }),
    );
    const token = auth.getAccessToken();
    client.token = 'account-two-token';
    client.tokenParsed = { sub: 'account-two' };
    client.onAuthSuccess?.();
    finish(true);
    expect(await token).toBeUndefined();
    expect(auth.subject()).toBe('account-two');
  });

  it('clears the exposed identity synchronously on disposal and ignores late callbacks and refresh', async () => {
    client.authenticated = true;
    client.token = 'test-token';
    client.tokenParsed = { sub: 'account-one' };
    await initialize();
    expect(auth.subject()).toBe('account-one');
    const success = client.onAuthSuccess!;
    const refreshed = client.onAuthRefreshSuccess!;
    const loggedOut = client.onAuthLogout!;
    const expired = client.onTokenExpired!;
    let finish!: (value: boolean) => void;
    client.updateToken.mockReturnValueOnce(
      new Promise((resolve) => {
        finish = resolve;
      }),
    );
    const token = auth.getAccessToken();
    TestBed.resetTestingModule();
    expect(auth.subject()).toBeUndefined();
    client.authenticated = true;
    client.token = 'late-token';
    client.tokenParsed = { sub: 'late-account' };
    success();
    refreshed();
    loggedOut();
    expired();
    finish(true);
    expect(await token).toBeUndefined();
    expect(auth.subject()).toBeUndefined();
    expect(client.updateToken).toHaveBeenCalledOnce();
  });

  it('does not clear a new account when an older account refresh fails', async () => {
    client.authenticated = true;
    client.token = 'account-one-token';
    client.tokenParsed = { sub: 'account-one' };
    await initialize();
    let reject!: (error: Error) => void;
    client.updateToken.mockReturnValueOnce(
      new Promise((_resolve, fail) => {
        reject = fail;
      }),
    );
    const token = auth.getAccessToken();
    client.token = 'account-two-token';
    client.tokenParsed = { sub: 'account-two' };
    client.onAuthSuccess?.();
    reject(new Error('Old refresh expired'));
    expect(await token).toBeUndefined();
    expect(auth.subject()).toBe('account-two');
    expect(client.clearToken).not.toHaveBeenCalled();
    expect(auth.error()).toBe('');
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

  it('provides a refreshed access token only while authenticated', async () => {
    await initialize();
    expect(await auth.getAccessToken()).toBeUndefined();
    expect(client.updateToken).not.toHaveBeenCalled();
    client.authenticated = true;
    client.token = 'old-token';
    client.onAuthSuccess?.();
    client.updateToken.mockImplementation(async () => {
      client.token = 'renewed-token';
      return true;
    });
    expect(await auth.getAccessToken()).toBe('renewed-token');
    expect(client.updateToken).toHaveBeenCalledWith(30);
    client.updateToken.mockRejectedValue(new Error('Expired'));
    expect(await auth.getAccessToken()).toBeUndefined();
    expect(auth.state().status).toBe('anonymous');
  });

  it('can explicitly reauthenticate when a resource rejects the current session', async () => {
    client.authenticated = true;
    await initialize();
    await auth.login(true);
    expect(client.login).toHaveBeenCalledWith({
      redirectUri: document.location.href,
      prompt: 'login',
    });
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
