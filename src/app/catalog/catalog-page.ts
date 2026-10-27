import { Component } from '@angular/core';
import { Catalog } from './catalog';
import { RouterLink } from '@angular/router';

@Component({
  imports: [Catalog, RouterLink],
  templateUrl: './catalog-page.html',
  styleUrl: './catalog-page.scss',
})
export class CatalogPage {}
