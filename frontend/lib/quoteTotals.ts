// Pure helpers for the quote editor — mirror the backend so totals can be
// previewed live while editing, and so the whole quote saves in one PATCH.
// The server (bookings/models/quotes.py: recalculate_totals + QuoteLineItem.save)
// remains the source of truth on save.
import { EventMealData } from "@/lib/api";
import { formatCurrency } from "@/lib/utils";

export interface LineItemInput {
  id?: number;
  variant?: number | null; // AddOnVariant id when the row came from the catalog
  category: string; // 'food' | 'beverage' | 'rental' | 'labor' | 'fee' | 'discount'
  description: string;
  quantity: number | string;
  unit: string; // 'per_guest' | 'per_hour' | 'flat' | 'each'
  unit_price: number | string;
  sort_order?: number;
}

export interface BookingTotals {
  food_total: number;
  subtotal: number;
  service_charge: number;
  tax_base: number;
  tax_amount: number;
  gratuity: number;
  total: number;
}

/** @deprecated alias — use BookingTotals (quotes and events share one shape). */
export type QuoteTotals = BookingTotals;

const round2 = (n: number): number => Math.round((n + Number.EPSILON) * 100) / 100;

/** Line total — mirrors BookingLineItem.save() in the backend. */
export function lineItemTotal(item: LineItemInput, guestCount: number): number {
  const qty = Number(item.quantity) || 0;
  const price = Number(item.unit_price) || 0;
  if (item.unit === "per_guest") return round2(price * guestCount);
  if (item.category === "discount") return -round2(Math.abs(qty * price));
  return round2(qty * price);
}

/**
 * The single source of truth for booking totals on the frontend — mirrors the
 * backend engine `bookings/services/totals.py: compute_booking_totals`. Used by
 * BOTH quotes and events so the number never differs between screens.
 *
 * `foodTotal` already includes any additional meals (the caller sums them, as
 * the backend does). `taxRate` is the EFFECTIVE decimal fraction (0.2 = 20%);
 * pass 0 when the booking isn't taxable. `serviceChargePct`/`gratuityPct` are
 * PERCENTAGES (20 = 20%) applied to the subtotal. Pipeline: subtotal → service
 * charge → tax (on subtotal + service charge if taxable) → gratuity (post-tax,
 * never taxed) → total. A discount is a negative line, so it reduces the subtotal
 * before everything. There is no per-line taxable/non-taxable split.
 */
export function computeBookingTotals(
  foodTotal: number,
  lineItems: LineItemInput[],
  guestCount: number,
  taxRate: number,
  serviceChargePct: number = 0,
  serviceChargeTaxable: boolean = true,
  gratuityPct: number = 0,
): BookingTotals {
  const food = round2(foodTotal || 0);
  let items = 0;
  for (const item of lineItems) items += lineItemTotal(item, guestCount);
  const subtotal = round2(food + items);
  const service_charge = round2((subtotal * (serviceChargePct || 0)) / 100);
  const tax_base = round2(subtotal + (serviceChargeTaxable ? service_charge : 0));
  const tax_amount = round2(tax_base * (taxRate || 0));
  const gratuity = round2((subtotal * (gratuityPct || 0)) / 100);
  return {
    food_total: food,
    subtotal,
    service_charge,
    tax_base,
    tax_amount,
    gratuity,
    total: round2(subtotal + service_charge + tax_amount + gratuity),
  };
}

/**
 * Quote convenience wrapper over {@link computeBookingTotals}: food = price/head
 * × guests (quotes have no additional meals). `taxRate` is a decimal fraction.
 */
/** Food cost of additional meals: each meal's price_per_head × its own guests. */
export function mealsFood(meals: { guest_count: number; price_per_head: string | null }[] | undefined): number {
  let total = 0;
  for (const m of meals || []) {
    const price = Number(m.price_per_head) || 0;
    if (price > 0 && m.guest_count) total += round2(price * m.guest_count);
  }
  return round2(total);
}

/** One labelled totals row per priced additional meal — shown in the breakdown on
 * both editors (and mirrored in the PDF) so each meal is a visible line. */
export function bookingMealRows(
  meals: { label?: string; guest_count: number; price_per_head: string | null }[] | undefined,
  currencySymbol: string,
): { label: string; total: number }[] {
  return (meals || [])
    .map((m) => ({ m, total: round2((Number(m.price_per_head) || 0) * (m.guest_count || 0)) }))
    .filter((r) => r.total > 0 || (Number(r.m.price_per_head) || 0) > 0)
    .map((r) => ({
      label: `${r.m.label || "Additional Meal"} (${formatCurrency(r.m.price_per_head || "0", currencySymbol)}/head × ${r.m.guest_count})`,
      total: r.total,
    }));
}

export function computeQuoteTotals(
  pricePerHead: number | string | null | undefined,
  guestCount: number | string | null | undefined,
  taxRate: number | string | null | undefined,
  lineItems: LineItemInput[],
  meals?: { guest_count: number; price_per_head: string | null }[],
  serviceChargePct: number | string | null | undefined = 0,
  serviceChargeTaxable: boolean = true,
  gratuityPct: number | string | null | undefined = 0,
): BookingTotals {
  const price = Number(pricePerHead) || 0;
  const guests = Number(guestCount) || 0;
  const food = round2((price > 0 ? round2(price * guests) : 0) + mealsFood(meals));
  return computeBookingTotals(
    food, lineItems, guests, Number(taxRate) || 0,
    Number(serviceChargePct) || 0, serviceChargeTaxable, Number(gratuityPct) || 0,
  );
}

export interface QuoteEditData {
  primary_contact: string;
  is_b2b: boolean;
  account: string;
  event_date: string;
  guest_count: number;
  gents: number;
  ladies: number;
  big_eaters: boolean;
  big_eaters_percentage: number;
  price_per_head: string;
  venue: string;
  venue_address: string;
  event_type: string;
  meal_type: string;
  booking_date: string;
  service_style: string;
  product: string;
  setup_time: string;
  guest_arrival_time: string;
  meal_time: string;
  end_time: string;
  tax_rate: string; // percent string (e.g. "20") as shown in the form
  service_charge_pct: string; // percent (e.g. "20")
  service_charge_taxable: boolean;
  gratuity_pct: string; // percent (e.g. "15")
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
/** Serialize add-on line items for a booking save (quote OR event). */
export function buildLineItemsPayload(lineItems: LineItemInput[]) {
  return lineItems.map((li) => ({
    ...(li.id ? { id: li.id } : {}),
    variant: li.variant ?? null,
    category: li.category,
    description: li.description,
    quantity: li.quantity,
    unit: li.unit,
    unit_price: li.unit_price,
    sort_order: li.sort_order ?? 0,
  }));
}

/** Serialize additional meals for a booking save (quote OR event). */
export function buildMealsPayload(meals: EventMealData[]) {
  return meals.map((m) => ({
    label: m.label,
    guest_count: m.guest_count,
    price_per_head: m.price_per_head || null,
    dish_ids: m.dishes,
    based_on_template: m.based_on_template,
    meal_time: m.meal_time || null,
    notes: m.notes,
  }));
}

export function buildQuoteSavePayload(
  editData: QuoteEditData,
  menuData: QuoteMenuData,
  lineItems: LineItemInput[],
  meals: EventMealData[] = [],
) {
  return {
    primary_contact: editData.primary_contact ? Number(editData.primary_contact) : null,
    is_b2b: editData.is_b2b,
    account: editData.is_b2b && editData.account ? Number(editData.account) : null,
    event_date: editData.event_date,
    gents: editData.gents,
    ladies: editData.ladies,
    guest_count: editData.guest_count,
    big_eaters: editData.big_eaters,
    big_eaters_percentage: editData.big_eaters_percentage,
    price_per_head: editData.price_per_head ? editData.price_per_head : null,
    venue: editData.venue ? Number(editData.venue) : null,
    venue_address: editData.venue_address,
    event_type: editData.event_type,
    meal_type: editData.meal_type || undefined,
    booking_date: editData.booking_date || null,
    service_style: editData.service_style || undefined,
    setup_time: editData.setup_time || null,
    guest_arrival_time: editData.guest_arrival_time || null,
    meal_time: editData.meal_time || null,
    end_time: editData.end_time || null,
    tax_rate: (parseFloat(editData.tax_rate || "0") / 100).toFixed(4),
    service_charge_pct: editData.service_charge_pct || "0",
    service_charge_taxable: editData.service_charge_taxable,
    gratuity_pct: editData.gratuity_pct || "0",
    product: editData.product ? Number(editData.product) : null,
    valid_until: editData.valid_until || null,
    notes: editData.notes,
    internal_notes: editData.internal_notes,
    dish_ids: menuData.dish_ids,
    based_on_template: menuData.based_on_template,
    line_items: buildLineItemsPayload(lineItems),
    additional_meals: buildMealsPayload(meals),
  };
}

/** The event save payload. Shares the line-item + meal serialization with quotes;
 * adds the event-only fields (name, gents/ladies split, timeline, counts,
 * kitchen instructions). Pure + unit-tested — the event editor calls this. */
export interface EventSaveInput {
  name: string;
  date: string;
  is_b2b: boolean;
  account: number | null;
  primary_contact: number | null;
  venue: number | null;
  venue_address: string;
  event_type: string;
  meal_type: string;
  booking_date: string;
  service_style: string;
  product: number | null;
  price_per_head: string | null;
  notes: string;
  kitchen_instructions: string;
  banquet_instructions: string;
  setup_instructions: string;
  guest_count: number;
  gents: number;
  ladies: number;
  guaranteed_count: number | null;
  final_count: number | null;
  final_count_due: string;
  big_eaters: boolean;
  big_eaters_percentage: number;
  setup_time: string;
  guest_arrival_time: string;
  meal_time: string;
  end_time: string;
  is_taxable: boolean;
  service_charge_pct: string;
  service_charge_taxable: boolean;
  gratuity_pct: string;
  dish_ids: number[];
  based_on_template: number | null;
  line_items: LineItemInput[];
  meals: EventMealData[];
}

export function buildEventSavePayload(v: EventSaveInput) {
  return {
    name: v.name,
    date: v.date,
    is_b2b: v.is_b2b,
    account: v.is_b2b ? v.account : null,
    primary_contact: v.primary_contact,
    venue: v.venue,
    venue_address: v.venue_address,
    event_type: v.event_type,
    meal_type: v.meal_type,
    booking_date: v.booking_date || null,
    service_style: v.service_style,
    product: v.product,
    price_per_head: v.price_per_head || null,
    notes: v.notes,
    kitchen_instructions: v.kitchen_instructions,
    banquet_instructions: v.banquet_instructions,
    setup_instructions: v.setup_instructions,
    guest_count: v.guest_count,
    gents: v.gents,
    ladies: v.ladies,
    guaranteed_count: v.guaranteed_count,
    final_count: v.final_count,
    final_count_due: v.final_count_due || null,
    big_eaters: v.big_eaters,
    big_eaters_percentage: v.big_eaters_percentage,
    setup_time: v.setup_time || null,
    guest_arrival_time: v.guest_arrival_time || null,
    meal_time: v.meal_time || null,
    end_time: v.end_time || null,
    is_taxable: v.is_taxable,
    service_charge_pct: v.service_charge_pct || "0",
    service_charge_taxable: v.service_charge_taxable,
    gratuity_pct: v.gratuity_pct || "0",
    dish_ids: v.dish_ids,
    based_on_template: v.based_on_template,
    line_items: buildLineItemsPayload(v.line_items),
    additional_meals: buildMealsPayload(v.meals),
  };
}
