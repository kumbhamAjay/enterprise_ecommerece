// Order pricing in INTEGER CENTS (exact). One place for the rules, used by both the checkout preview and order creation.
export const SHIPPING_FLAT_CENTS = 900; // $9.00
export const FREE_SHIPPING_FROM_CENTS = 10000; // free from $100.00
export const TAX_RATE = 0; // prices are tax-inclusive for now; ponytail: per-country tax rules when needed

export const toCents = (v: string | number) => Math.round(Number(v) * 100);
export const fromCents = (c: number) => (c / 100).toFixed(2);

export function priceOrder(subtotalCents: number) {
  const shipping = subtotalCents === 0 || subtotalCents >= FREE_SHIPPING_FROM_CENTS ? 0 : SHIPPING_FLAT_CENTS;
  const tax = Math.round(subtotalCents * TAX_RATE);
  return {
    subtotal: fromCents(subtotalCents),
    shipping: fromCents(shipping),
    tax: fromCents(tax),
    total: fromCents(subtotalCents + shipping + tax),
    amountToFreeShipping: subtotalCents > 0 && shipping > 0 ? fromCents(FREE_SHIPPING_FROM_CENTS - subtotalCents) : "0.00",
  };
}
