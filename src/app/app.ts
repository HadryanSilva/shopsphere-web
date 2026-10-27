import { Component } from '@angular/core';
import { RouterOutlet } from '@angular/router';
import { Catalog } from './catalog/catalog';

@Component({
  imports: [RouterOutlet, Catalog],
  selector: 'app-root',
  styleUrl: './app.scss',
  templateUrl: './app.html',
})
export class App {}
