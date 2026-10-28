import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { AuthService } from '../auth/auth.service';
import { CatalogApi } from '../catalog/catalog-api';
import { CartApi } from './cart-api';

describe('CartApi', () => {
  let api: CartApi;
  let http: HttpTestingController;
  const auth = { getAccessToken: vi.fn(async (): Promise<string | undefined> => 'test-token') };
  beforeEach(() => {
    auth.getAccessToken.mockReset().mockResolvedValue('test-token');
    TestBed.configureTestingModule({
      providers: [
        provideHttpClient(),
        provideHttpClientTesting(),
        { provide: AuthService, useValue: auth },
      ],
    });
    api = TestBed.inject(CartApi);
    http = TestBed.inject(HttpTestingController);
  });
  afterEach(() => http.verify());

  it('uses the refreshed user token only for the scoped cart requests', async () => {
    api.getCart().subscribe();
    await Promise.resolve();
    const get = http.expectOne('/api/v1/carts/me');
    expect(get.request.headers.get('Authorization')).toBe('Bearer test-token');
    get.flush({});
    api.update('product', 3).subscribe();
    await Promise.resolve();
    const patch = http.expectOne('/api/v1/carts/me/items/product');
    expect(patch.request.method).toBe('PATCH');
    expect(patch.request.body).toEqual({ quantity: 3 });
    patch.flush(null);
    api.remove('product').subscribe();
    await Promise.resolve();
    const remove = http.expectOne('/api/v1/carts/me/items/product');
    expect(remove.request.method).toBe('DELETE');
    expect(remove.request.body).toBeNull();
    remove.flush(null);
    TestBed.inject(CatalogApi).getProduct('product').subscribe();
    const publicRead = http.expectOne('/api/v1/products/product');
    expect(publicRead.request.headers.has('Authorization')).toBe(false);
    publicRead.flush({});
    expect(auth.getAccessToken).toHaveBeenCalledTimes(3);
  });

  it('fails locally with 401 when no valid token is available', async () => {
    auth.getAccessToken.mockResolvedValue(undefined);
    const error = vi.fn();
    api.add('product', 2).subscribe({ error });
    await Promise.resolve();
    expect(error).toHaveBeenCalledWith(expect.objectContaining({ status: 401 }));
    http.expectNone((request) => request.url.startsWith('/api/v1/carts'));
  });
});
