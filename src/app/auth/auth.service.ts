import { DOCUMENT } from '@angular/common';
import { HttpClient } from '@angular/common/http';
import { DestroyRef, inject, Injectable, InjectionToken, signal } from '@angular/core';
import { firstValueFrom } from 'rxjs';
import Keycloak, { KeycloakConfig } from 'keycloak-js';

export const KEYCLOAK_FACTORY = new InjectionToken<(config: KeycloakConfig) => Keycloak>(
  'Keycloak factory',
  {
    providedIn: 'root',
    factory: () => (config) => new Keycloak(config),
  },
);

export type AuthState =
  | { status: 'initializing' | 'anonymous' | 'unavailable' }
  | { status: 'authenticated'; username: string };

@Injectable({ providedIn: 'root' })
export class AuthService {
  private readonly http = inject(HttpClient);
  private readonly document = inject(DOCUMENT);
  private readonly factory = inject(KEYCLOAK_FACTORY);
  private readonly authState = signal<AuthState>({ status: 'initializing' });
  private readonly authError = signal('');
  private readonly pending = signal(false);
  private client?: Keycloak;
  private initialization?: Promise<void>;
  readonly state = this.authState.asReadonly();
  readonly error = this.authError.asReadonly();
  readonly actionPending = this.pending.asReadonly();

  constructor() {
    inject(DestroyRef).onDestroy(() => {
      void this.discardClient();
    });
  }

  initialize(): Promise<void> {
    if (this.initialization) return this.initialization;
    if (this.client && this.state().status !== 'unavailable') return Promise.resolve();
    this.initialization = this.initializeSession().finally(() => {
      this.initialization = undefined;
    });
    return this.initialization;
  }

  private async initializeSession(): Promise<void> {
    this.authState.set({ status: 'initializing' });
    this.authError.set('');
    try {
      const config = await firstValueFrom(
        this.http.get<{ url: string; realm: string; clientId: string }>('/auth-config.json', {
          timeout: 10000,
        }),
      );
      if (
        !config ||
        typeof config.url !== 'string' ||
        !config.realm?.trim() ||
        !config.clientId?.trim()
      ) {
        throw new Error('Invalid authentication configuration');
      }
      const server = new URL(config.url);
      const localHttp =
        server.protocol === 'http:' &&
        ['localhost', '127.0.0.1', '[::1]'].includes(server.hostname);
      if (server.protocol !== 'https:' && !localHttp) throw new Error('HTTPS required');
      const client = this.factory({
        url: config.url,
        realm: config.realm,
        clientId: config.clientId,
      });
      this.client = client;
      client.onAuthSuccess = () => this.synchronize(client);
      client.onAuthRefreshSuccess = () => this.synchronize(client);
      client.onAuthLogout = () => {
        if (this.client === client) this.authState.set({ status: 'anonymous' });
      };
      client.onTokenExpired = () => {
        void this.refreshSession(client);
      };
      await client.init({
        onLoad: 'check-sso',
        flow: 'standard',
        pkceMethod: 'S256',
        useNonce: true,
        responseMode: 'query',
        checkLoginIframe: false,
        silentCheckSsoRedirectUri: `${this.document.location.origin}/silent-check-sso.html`,
        silentCheckSsoFallback: false,
        messageReceiveTimeout: 5000,
      });
      this.synchronize(client);
    } catch {
      await this.discardClient();
      const cleanUrl = this.redirectUri();
      this.document.defaultView?.history.replaceState(
        this.document.defaultView.history.state,
        '',
        cleanUrl,
      );
      this.authState.set({ status: 'unavailable' });
      this.authError.set(
        'Não foi possível verificar a sessão. Pode continuar a explorar a loja e tentar novamente.',
      );
    }
  }

  async login(): Promise<void> {
    const client = this.client;
    if (!client || this.pending() || this.state().status !== 'anonymous') return;
    this.pending.set(true);
    this.authError.set('');
    try {
      await client.login({ redirectUri: this.redirectUri() });
    } catch {
      this.authError.set('Não foi possível iniciar a sessão. Tente novamente.');
    } finally {
      this.pending.set(false);
    }
  }

  async logout(): Promise<void> {
    const client = this.client;
    if (!client || this.pending() || this.state().status !== 'authenticated') return;
    this.pending.set(true);
    this.authError.set('');
    try {
      await client.logout({ redirectUri: this.redirectUri() });
    } catch {
      this.authError.set('Não foi possível terminar a sessão. Tente novamente.');
    } finally {
      this.pending.set(false);
    }
  }

  private synchronize(client: Keycloak): void {
    if (this.client !== client) return;
    if (!client.authenticated) {
      this.authState.set({ status: 'anonymous' });
      return;
    }
    const username: unknown =
      client.tokenParsed?.['preferred_username'] ?? client.tokenParsed?.['name'];
    this.authState.set({
      status: 'authenticated',
      username: typeof username === 'string' && username.trim() ? username : 'Minha conta',
    });
  }

  private async refreshSession(client: Keycloak): Promise<void> {
    if (this.client !== client || this.state().status !== 'authenticated') return;
    try {
      await client.updateToken(30);
      this.synchronize(client);
    } catch {
      if (this.client !== client) return;
      await client.clearToken();
      this.authState.set({ status: 'anonymous' });
      this.authError.set('A sessão terminou. Entre novamente para continuar.');
    }
  }

  private redirectUri(): string {
    const url = new URL(this.document.location.href);
    for (const key of [
      'code',
      'state',
      'session_state',
      'iss',
      'error',
      'error_description',
      'error_uri',
    ])
      url.searchParams.delete(key);
    return url.href;
  }

  private async discardClient(): Promise<void> {
    const client = this.client;
    this.client = undefined;
    if (!client) return;
    client.onAuthSuccess =
      client.onAuthRefreshSuccess =
      client.onAuthLogout =
      client.onTokenExpired =
        undefined;
    await client.clearToken().catch(() => {});
  }
}
