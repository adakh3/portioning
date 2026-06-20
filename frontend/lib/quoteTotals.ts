// Pure helpers for the quote editor — mirror the backend so totals can be
// previewed live while editing, and so the whole quote saves in one PATCH.
// The server (bookings/models/quotes.py: recalculate_totals + QuoteLineItem.save)
// remains the source of truth on save.

export interface LineItemInput {
  id?: number;
  category: string; // 'food' | 'beverage' | 'rental' | 'labor' | 'fee' | 'discount'
  description: string;
  quantity: number | string;
  unit: string; // 'per_guest' | 'per_hour' | 'flat' | 'each'
  unit_price: number | string;
  is_taxable: boolean;
  sort_order?: number;
}

export interface QuoteTotals {
  food_total: number;
  subtotal: number;
  tax_amount: number;
  total: number;
}

const round2 = (n: number): number => Math.round((n + Number.EPSILON) * 100) / 100;

/** Line total — mirrors QuoteLineItem.save() in the backend. */
export function lineItemTotal(item: LineItemInput, guestCount: number): number {
  const qty = Number(item.quantity) || 0;
  const price = Number(item.unit_price) || 0;
  if (item.unit === "per_guest") return round2(price * guestCount);
  if (item.category === "discount") return -round2(Math.abs(qty * price));
  return round2(qty * price);
}

/**
 * Compute quote totals. `taxRate` is a DECIMAL fraction (0.2 = 20%), matching
 * how the backend stores it; the caller converts from any percent input.
 * Mirrors Quote.recalculate_totals(): food (price/head × guests) goes into the
 * taxable subtotal; line items split by is_taxable; tax applies to taxable only.
 */
export function computeQuoteTotals(
  pricePerHead: number | string | null | undefined,
  guestCount: number | string | null | undefined,
  taxRate: number | string | null | undefined,
  lineItems: LineItemInput[],
): QuoteTotals {
  const price = Number(pricePerHead) || 0;
  const guests = Number(guestCount) || 0;
  const rate = Number(taxRate) || 0;

  const food = price > 0 ? round2(price * guests) : 0;
  let taxable = food;
  let nonTaxable = 0;
  for (const item of lineItems) {
    const lt = lineItemTotal(item, guests);
    if (item.is_taxable) taxable += lt;
    else nonTaxable += lt;
  }
  const subtotal = round2(taxable + nonTaxable);
  const tax_amount = round2(taxable * rate);
  return { food_total: food, subtotal, tax_amount, total: round2(subtotal + tax_amount) };
}

export interface QuoteEditData {
  primary_contact: string;
  is_b2b: boolean;
  account: string;
  event_date: string;
  guest_count: string;
  price_per_head: string;
  venue: string;
  venue_address: string;
  event_type: string;
  meal_type: string;
  booking_date: string;
  service_style: string;
  tax_rate: string; // percent string (e.g. "20") as shown in the form
  valid_until: string;
  notes: string;
  internal_notes: string;
}

export interface QuoteMenuData {
  dish_ids: number[];
  based_on_template: number | null;
}

/**
 * Assemble the single PATCH body for the whole quote: details + menu + line
 * items together. Replaces the old fragmented saves (details PATCH, MenuBuilder
 * dish-only save, per-line-item CRUD) — and crucially carries price_per_head
 * alongside the menu so the food cost actually reaches the totals.
 */
export function buildQuoteSavePayload(
  editData: QuoteEditData,
  menuData: QuoteMenuData,
  lineItems: LineItemInput[],
) {
  return {
    primary_contact: editData.primary_contact ? Number(editData.primary_contact) : null,
    is_b2b: editData.is_b2b,
    account: editData.is_b2b && editData.account ? Number(editData.account) : null,
    event_date: editData.event_date,
    guest_count: Number(editData.guest_count),
    price_per_head: editData.price_per_head ? editData.price_per_head : null,
    venue: editData.venue ? Number(editData.venue) : null,
    venue_address: editData.venue_address,
    event_type: editData.event_type,
    meal_type: editData.meal_type || undefined,
    booking_date: editData.booking_date || null,
    service_style: editData.service_style || undefined,
    tax_rate: (parseFloat(editData.tax_rate || "0") / 100).toFixed(4),
    valid_until: editData.valid_until || null,
    notes: editData.notes,
    internal_notes: editData.internal_notes,
    dish_ids: menuData.dish_ids,
    based_on_template: menuData.based_on_template,
    line_items: lineItems.map((li) => ({
      ...(li.id ? { id: li.id } : {}),
      category: li.category,
      description: li.description,
      quantity: li.quantity,
      unit: li.unit,
      unit_price: li.unit_price,
      is_taxable: li.is_taxable,
      sort_order: li.sort_order ?? 0,
    })),
  };
}
