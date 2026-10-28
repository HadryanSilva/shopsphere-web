import { HttpErrorResponse } from '@angular/common/http';

export function isMissingCart(error: unknown): boolean {
  // The public API has no machine-readable error code; other 404s must not look empty.
  return (
    error instanceof HttpErrorResponse &&
    error.status === 404 &&
    error.error?.detail === 'Cart not found'
  );
}

export function cartError(error: unknown, mutation = false): string {
  const status = error instanceof HttpErrorResponse ? error.status : 0;
  switch (status) {
    case 401:
      return 'A sessão não foi aceite. Entre novamente para aceder ao carrinho.';
    case 403:
      return 'Não tem permissão para esta operação no carrinho.';
    case 400:
      return 'Os dados não foram aceites. Verifique a quantidade e atualize o carrinho.';
    case 404:
      return 'O carrinho, item ou produto já não pode ser consultado. Atualize o carrinho.';
    case 409:
      return 'O carrinho ou o produto mudou, ou existe um checkout em curso. Atualize o carrinho antes de continuar.';
    default:
      return mutation
        ? 'Não foi possível confirmar a alteração. Consulte o carrinho antes de repetir.'
        : 'O carrinho está temporariamente indisponível. Tente novamente.';
  }
}
