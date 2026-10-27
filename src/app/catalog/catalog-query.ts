import { ParamMap } from '@angular/router';

export const sortOptions = [
  { value: 'name,asc', label: 'Nome: A–Z' },
  { value: 'name,desc', label: 'Nome: Z–A' },
  { value: 'price,asc', label: 'Preço: menor primeiro' },
  { value: 'price,desc', label: 'Preço: maior primeiro' },
  { value: 'createdAt,desc', label: 'Mais recentes' },
] as const;

export interface CatalogQuery {
  name: string;
  minPrice: string;
  maxPrice: string;
  sort: string;
  page: number;
}

export function readCatalogQuery(params: ParamMap): CatalogQuery {
  const page = params.get('page') ?? '0';
  const sort = params.get('sort') ?? '';
  return {
    name: (params.get('name') ?? '').trim(),
    minPrice: (params.get('minPrice') ?? '').trim().replace(',', '.'),
    maxPrice: (params.get('maxPrice') ?? '').trim().replace(',', '.'),
    sort: sortOptions.some((option) => option.value === sort) ? sort : 'name,asc',
    page: /^\d+$/.test(page) && Number(page) <= 2147483647 ? Number(page) : 0,
  };
}

export function priceRangeError(minPrice: string, maxPrice: string): string {
  if (
    [minPrice, maxPrice].some(
      (price) =>
        price !== '' && (!/^\d+(\.\d{1,2})?$/.test(price) || !Number.isFinite(Number(price))),
    )
  ) {
    return 'Introduza preços positivos ou zero, com até duas casas decimais.';
  }
  const cents = (price: string) => {
    const [whole, fraction = ''] = price.split('.');
    return BigInt(whole) * 100n + BigInt(fraction.padEnd(2, '0'));
  };
  if (minPrice !== '' && maxPrice !== '' && cents(minPrice) > cents(maxPrice)) {
    return 'O preço mínimo não pode ser maior que o preço máximo.';
  }
  return '';
}
