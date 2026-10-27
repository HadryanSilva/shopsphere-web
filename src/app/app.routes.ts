import { Routes } from '@angular/router';
import { CatalogPage } from './catalog/catalog-page';

export const routes: Routes = [
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
