import { Component, inject } from '@angular/core';
import { ActivatedRoute, Router, RouterOutlet } from '@angular/router';
import { toSignal } from '@angular/core/rxjs-interop';
import { map } from 'rxjs';
import { Catalog } from './catalog/catalog';

@Component({
  imports: [RouterOutlet, Catalog],
  selector: 'app-root',
  styleUrl: './app.scss',
  templateUrl: './app.html',
})
export class App {
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  protected readonly searchName = toSignal(
    this.route.queryParamMap.pipe(map((params) => params.get('name') ?? '')),
    { initialValue: '' },
  );

  protected search(name: string, event: Event) {
    event.preventDefault();
    void this.router.navigate([], {
      relativeTo: this.route,
      queryParams: { name: name.trim() || null, page: null },
      queryParamsHandling: 'merge',
      fragment: 'catalogo',
    });
  }
}
