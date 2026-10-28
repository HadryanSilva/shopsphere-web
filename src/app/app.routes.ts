import { Routes } from '@angular/router';
import { CatalogPage } from './catalog/catalog-page';

export const routes: Routes = [
  {
    path: 'cart',
    loadComponent: () => import('./cart/cart-page').then((module) => module.CartPage),
    title: 'Carrinho | ShopSphere',
  },
  {
    path: '',
    pathMatch: 'full',
    component: CatalogPage,
    title: 'ShopSphere — Explore o seu próximo favorito',
  },
  {
    path: 'products/:id',
    loadComponent: () =>
      import('./product-detail/product-detail').then((module) => module.ProductDetail),
    title: 'Produto | ShopSphere',
  },
];
