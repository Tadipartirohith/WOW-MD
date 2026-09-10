/**
 * How an offering's price reads.
 *
 * Copied from the web client's VendorServices.tsx rather than shared, for the
 * same reason as business-status.ts: on that side these live inside a component
 * file, and importing it here would pull React Query and a browser-only
 * uploader into this bundle. The wording is kept identical because a vendor
 * comparing their own listing on two screens must not see two different prices
 * for one offering.
 */

export const PRICING_LABEL: Record<string, string> = {
  fixed: 'Fixed price',
  per_person: 'Per person',
  per_hour: 'Per hour',
  per_day: 'Per day',
  per_session: 'Per session',
  per_item: 'Per item',
  starting_from: 'Starting from',
  custom_quote: 'Custom quote',
  no_public_price: 'Price on request',
};

/** The two models that publish no amount — the vendor quotes after the request. */
export const QUOTE_ONLY = ['custom_quote', 'no_public_price'];

/** Where a quantity is part of the price rather than decoration. */
export const QUANTITY_MODELS = ['per_person', 'per_item', 'per_hour', 'per_day', 'per_session'];

export interface PricedOffering {
  pricingModel: string;
  price: string | null;
  currency: string;
  unitLabel: string | null;
}

export function priceLabel(offering: PricedOffering): string {
  if (QUOTE_ONLY.includes(offering.pricingModel)) return PRICING_LABEL[offering.pricingModel];
  const amount = `${offering.currency} ${Number(offering.price).toLocaleString()}`;
  if (offering.pricingModel === 'starting_from') return `From ${amount}`;
  return offering.unitLabel ? `${amount} ${offering.unitLabel}` : amount;
}
