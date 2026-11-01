import { OrderResponse } from './order-api';

export function isOrderResponse(value: unknown, expectedId?: string): value is OrderResponse {
  const order = value as OrderResponse | null;
  const uuid = /^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i;
  const money = (amount: unknown) =>
    typeof amount === 'number' && Number.isFinite(amount) && amount >= 0;
  return (
    !!order &&
    typeof order.id === 'string' &&
    uuid.test(order.id) &&
    (expectedId === undefined || order.id.toLowerCase() === expectedId.toLowerCase()) &&
    typeof order.status === 'string' &&
    typeof order.currency === 'string' &&
    /^[A-Z]{3}$/.test(order.currency) &&
    typeof order.updatedAt === 'string' &&
    Number.isFinite(Date.parse(order.updatedAt)) &&
    [order.subtotal, order.discountAmount, order.shippingAmount, order.totalAmount].every(money) &&
    Array.isArray(order.items) &&
    order.items.length > 0 &&
    order.items.every(
      (item) =>
        !!item &&
        typeof item.productId === 'string' &&
        uuid.test(item.productId) &&
        typeof item.productName === 'string' &&
        !!item.productName.trim() &&
        Number.isSafeInteger(item.quantity) &&
        item.quantity > 0 &&
        money(item.unitPrice) &&
        money(item.lineTotal),
    )
  );
}
