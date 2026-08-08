// The frontend's mirror of the backend money math — kept only while the editing
// surfaces still compute their own totals.
//
// REL-465 is retiring it: a surface asks `POST /api/pricing/preview` for its
// numbers instead, so what is on screen IS what a save would store. Everything
// here goes when the last consumer does. What a booking SENDS lives in
// `bookingPayload.ts` and is staying — don't add payload code here.
import { formatCurrency } from "@/lib/utils";
import { buildGuestCountsPayload, effectiveMealCount } from "@/lib/bookingPayload";
import type { GuestSegmentMeta, LineItemInput, MealAudienceInput } from "@/lib/bookingPayload";

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

/** A line item's quantity or price — the mirror of `_line_number` in totals.py.
 *
 * Keeps the sign (a discount is routinely typed as a negative price) but refuses
 * anything unusable, INCLUDING an out-of-range magnitude. `Number("1e400")` is
 * `Infinity`, which is truthy, so `Number(x) || 0` let it through and every total
 * downstream became `Infinity`; the backend's `Decimal("1e400")` is finite and blew
 * up in `quantize` instead. Same bound, same answer, on both sides. */
const lineNumber = (value: unknown): number => {
  const n = Number(value);
  return Number.isFinite(n) && Math.abs(n) <= MAX_USABLE_RATE ? n : 0;
};

/** Line total — mirrors `line_item_total` in the backend engine. */
export function lineItemTotal(item: LineItemInput, guestCount: number): number {
  const qty = lineNumber(item.quantity);
  const price = lineNumber(item.unit_price);
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
  // Percentage charges are taken on the subtotal but never on a NEGATIVE one: an
  // over-large discount used to flip the service charge and gratuity negative too,
  // compounding the error rather than bounding it. Mirrors `charge_base` in
  // bookings/services/totals.py — the save is rejected outright, so this is what
  // keeps the live preview honest while the user is still typing.
  const chargeBase = Math.max(subtotal, 0);
  const service_charge = round2((chargeBase * (serviceChargePct || 0)) / 100);
  const tax_base = round2(subtotal + (serviceChargeTaxable ? service_charge : 0));
  const tax_amount = round2(tax_base * (taxRate || 0));
  const gratuity = round2((chargeBase * (gratuityPct || 0)) / 100);
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
/** Food cost of additional meals: each meal's price_per_head × its (effective) guests.
 * Pass the booking's segment context to price audience-scoped meals by their derived
 * count; without it, each meal's own `guest_count` is used (back-compat). */
export function mealsFood(
  meals: (MealAudienceInput & { price_per_head: string | null })[] | undefined,
  guestCount?: number,
  segmentCounts?: Record<string, number>,
  meta?: GuestSegmentMeta[],
): number {
  let total = 0;
  for (const m of meals || []) {
    const price = Number(m.price_per_head) || 0;
    const count = effectiveMealCount(m, guestCount, segmentCounts, meta);
    // `count > 0`, not just truthy: a negative count was summed here and dropped by
    // the backend's `meal_rows`, so the preview and the saved total disagreed by a
    // whole meal. A meal is a charge — neither a negative rate nor a negative head
    // count is one. Pinned in both engines by the shared `meal_cases`.
    if (price > 0 && count > 0) total += round2(price * count);
  }
  return round2(total);
}

/** One labelled totals row per priced additional meal — shown in the breakdown on
 * both editors (and mirrored in the PDF) so each meal is a visible line. */
export function bookingMealRows(
  meals: (MealAudienceInput & { label?: string; price_per_head: string | null })[] | undefined,
  currencySymbol: string,
  guestCount?: number,
  segmentCounts?: Record<string, number>,
  meta?: GuestSegmentMeta[],
): { label: string; total: number }[] {
  return (meals || [])
    .map((m) => {
      const count = effectiveMealCount(m, guestCount, segmentCounts, meta);
      return { m, count, total: round2((Number(m.price_per_head) || 0) * count) };
    })
    .filter((r) => r.total > 0 || (Number(r.m.price_per_head) || 0) > 0)
    .map((r) => ({
      label: `${r.m.label || "Additional Meal"} (${formatCurrency(r.m.price_per_head || "0", currencySymbol)}/head × ${r.count})`,
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
  segmentCounts: Record<string, number> = {},
  segmentMeta: GuestSegmentMeta[] = [],
  segmentPrices: Record<string, string> = {},
): BookingTotals {
  const price = Number(pricePerHead) || 0;
  const guests = Number(guestCount) || 0;
  // Segment-aware food when the org exposes segments (kids/vendor multipliers +
  // per-segment overrides); otherwise flat price × guests. Both reduce identically
  // with no breakdown.
  const menuFood = segmentMeta.length
    ? segmentFood(price, guests, segmentCounts, segmentMeta, segmentPrices)
    : (price > 0 ? round2(price * guests) : 0);
  const food = round2(menuFood + mealsFood(meals, guests, segmentCounts, segmentMeta));
  return computeBookingTotals(
    food, lineItems, guests, Number(taxRate) || 0,
    Number(serviceChargePct) || 0, serviceChargeTaxable, Number(gratuityPct) || 0,
  );
}

// ── Guest segments (kids/vendor buckets) — mirror of the backend resolver +
// segment_food_total in bookings/services/totals.py (REL-415). ──

/** AC14: warn (don't block) when a booking has BOTH a vendor additional-cover
 * count AND a vendor-labelled additional meal — the two ways to feed vendors,
 * entered at once (double-entry). */
export function hasVendorDoubleEntry(
  segmentCounts: Record<string, number>,
  meals: { label?: string }[] | undefined,
  meta: GuestSegmentMeta[],
): boolean {
  const vendorSeg = meta.find((m) => !m.counts_toward_total && /vendor/i.test(m.name));
  const vendorCovers = vendorSeg ? (segmentCounts[vendorSeg.name] || 0) : 0;
  const vendorMeal = (meals || []).some((m) => /vendor/i.test(m.label || ""));
  return vendorCovers > 0 && vendorMeal;
}

/**
 * Per-head food across the guest segments — mirror of `segment_food_total`.
 * With no breakdown, the whole count is priced at the default segment's multiplier
 * (or 1.0), reducing to `price_per_head × guest_count`.
 */
/** The one accepted spelling of a rate — the exact mirror of the backend's
 * `_RATE_RE`. Anchored ASCII digits, optional single dot, no exponent, no sign. */
const RATE_RE = /^\s*\d+(?:\.\d+)?\s*$/;

/** Nothing priceable is worth more than this per cover — mirrors `MAX_USABLE_RATE`. */
const MAX_USABLE_RATE = 99999999.99;

/** A finite, non-negative, in-range number, or `null` when the value can't be used
 * as money. `null` means "fall back", never "free" (REL-449). Mirror of the backend
 * `_usable_rate`.
 *
 * Strings go through `RATE_RE` rather than bare `Number()`, because `Number`'s
 * coercion table and `Decimal`'s parser accept different languages, and every
 * disagreement is money one side charges and the other doesn't:
 * `Number("  ")`, `Number(false)` and `Number([])` are all **0** — which would price
 * a cover at zero where the backend falls back to the multiplier — while
 * `Decimal("1_000")`, `Decimal("١٢٣")` and `Decimal("５")` all parse, storing an
 * amount the customer's preview never showed. Both halves are closed by insisting
 * on one plain spelling. */
export function usableRate(value: number | string | null | undefined): number | null {
  if (value == null || value === "") return null;
  if (typeof value === "number") {
    return Number.isFinite(value) && value >= 0 && value <= MAX_USABLE_RATE ? value : null;
  }
  if (typeof value !== "string" || !RATE_RE.test(value)) return null;
  const n = Number(value);
  return Number.isFinite(n) && n >= 0 && n <= MAX_USABLE_RATE ? n : null;
}

/** The per-cover price for a segment, rounded to cents — mirror of the backend
 * `segment_effective_rate`. A per-segment `override` (flat/custom rate) wins;
 * else `round(base price × multiplier)`.
 *
 * Always **finite and non-negative** (REL-449). Bad input is refused at the API, so
 * nothing here should ever be junk — but a rate is money, and this also has to hold
 * for rows already in the database.
 *
 * Unusable input **falls back; it never makes a cover free.** An unusable override
 * is ignored (the segment reverts to its multiplier), and an unusable multiplier
 * reverts to `1.0` — full price. Flooring to zero instead would turn a bad config
 * value into a silent discount, which is the failure mode a caterer would never
 * spot. The one thing always refused is a negative, which would otherwise pay the
 * customer to attend. */
export function segmentEffectiveRate(
  pricePerHead: number | string | null | undefined,
  priceMultiplier: string | number | null | undefined,
  override?: string | number | null,
): number {
  const o = usableRate(override);
  if (o !== null) return round2(o);
  const mult = usableRate(priceMultiplier) ?? 1;
  return round2((usableRate(pricePerHead) ?? 0) * mult);
}

/** Low-level food sum over already-resolved segment rows — the exact mirror of the
 * backend `segment_food_total` (both run the shared `segment_food_cases`). Rounds
 * per cover then sums, so itemized lines add up to this to the cent. */
export function segmentFoodFromRows(
  pricePerHead: number | string | null | undefined,
  rows: { count: number; price_multiplier: string | number | null | undefined; price_override?: string | number | null }[],
): number {
  return round2(rows.reduce((t, r) => t + segmentEffectiveRate(pricePerHead, r.price_multiplier, r.price_override) * (r.count || 0), 0));
}

export interface SegmentFoodRow { name: string; count: number; rate: number; amount: number; }

/** Itemized food lines for display — mirror of the backend `segment_food_rows`.
 * Returns `null` when there is nothing to itemize (no price, <2 segments, or a
 * single shared rate), so the caller shows the single food line and Gents/Ladies /
 * count-only bookings stay byte-identical. */
export function segmentFoodRows(
  pricePerHead: number | string | null | undefined,
  guestCount: number,
  explicit: Record<string, number>,
  meta: GuestSegmentMeta[],
  prices: Record<string, string> = {},
): SegmentFoodRow[] | null {
  const byName: Record<string, GuestSegmentMeta> = Object.fromEntries(meta.map((m) => [m.name, m]));
  const built = buildGuestCountsPayload(guestCount, explicit, meta, prices);
  let resolved: { name: string; count: number; mult: string | number }[];
  if (built.length === 0) {
    const def = meta.find((m) => m.is_default && m.counts_toward_total);
    resolved = (guestCount || 0) > 0 ? [{ name: def?.name ?? "", count: guestCount, mult: def ? def.price_multiplier : 1 }] : [];
  } else {
    resolved = built.map((r) => ({ name: r.segment, count: r.count, mult: byName[r.segment]?.price_multiplier ?? 1 }));
  }
  return segmentFoodRowsFromRows(
    pricePerHead,
    resolved
      // Order by the org's segment order so the display matches the PDF/backend
      // (which read rows ordered by sort_order), not the payload's explicit-then-default order.
      .sort((a, b) => (byName[a.name]?.sort_order ?? 0) - (byName[b.name]?.sort_order ?? 0))
      .map((r) => ({
        name: r.name,
        count: r.count,
        price_multiplier: r.mult,
        // A default (Adults) segment never carries an override; others may.
        price_override:
          byName[r.name]?.is_default && byName[r.name]?.counts_toward_total
            ? undefined
            : prices[r.name],
      })),
  );
}

/** Itemized food lines from ALREADY-RESOLVED segments — the exact mirror of the
 * backend `segment_food_rows(price_per_head, segments)`, which is handed resolved
 * rows rather than UI state.
 *
 * `segmentFoodRows` above resolves UI state and delegates here, the same way
 * `segmentFood` pairs with `segmentFoodFromRows`. Splitting it out is what lets the
 * shared golden `itemized_rows_cases` run against BOTH engines: until this existed,
 * the two functions took different arguments and could never be compared. */
export function segmentFoodRowsFromRows(
  pricePerHead: number | string | null | undefined,
  rows: { name: string; count: number; price_multiplier: string | number | null | undefined; price_override?: string | number | null }[],
): SegmentFoodRow[] | null {
  const built = rows
    .filter((r) => (r.count || 0) > 0)
    .map((r) => {
      const rate = segmentEffectiveRate(pricePerHead, r.price_multiplier, r.price_override);
      return { name: r.name ?? "", count: r.count, rate, amount: round2(rate * r.count) };
    });
  const distinctRates = new Set(built.map((r) => r.rate));
  if (!built.some((r) => r.rate > 0) || built.length < 2 || distinctRates.size < 2) return null;
  return built;
}

export function segmentFood(
  pricePerHead: number | string | null | undefined,
  guestCount: number,
  explicit: Record<string, number>,
  meta: GuestSegmentMeta[],
  prices: Record<string, string> = {},
): number {
  const byName: Record<string, GuestSegmentMeta> = Object.fromEntries(meta.map((m) => [m.name, m]));
  const built = buildGuestCountsPayload(guestCount, explicit, meta, prices);
  let rows: { count: number; price_multiplier: string | number; price_override?: string }[];
  if (built.length === 0) {
    const def = meta.find((m) => m.is_default && m.counts_toward_total);
    rows = (guestCount || 0) > 0 ? [{ count: guestCount, price_multiplier: def ? def.price_multiplier : 1 }] : [];
  } else {
    rows = built.map((r) => ({
      count: r.count,
      price_multiplier: byName[r.segment]?.price_multiplier ?? 1,
      // The default segment ignores overrides (uses base); others honour the payload's.
      price_override: (byName[r.segment]?.is_default && byName[r.segment]?.counts_toward_total) ? undefined : r.price_per_head,
    }));
  }
  return segmentFoodFromRows(pricePerHead, rows);
}

/** A booking's additional meals as read-only timeline rows.
 *
 * Derived on every render rather than copied into entries: the meal owns its
 * time (along with its price and menu), so moving the meal moves the row and the
 * two can never disagree. Untimed meals are left out — they aren't a moment yet.
 */
export function timelineMealRows(
  meals: { label?: string; meal_time?: string | null }[] | undefined,
): { label: string; time: string }[] {
  return (meals || [])
    .filter((m) => m.meal_time)
    .map((m) => ({
      label: m.label?.trim() || "Additional meal",
      time: m.meal_time!.includes("T") ? m.meal_time!.slice(11, 16) : m.meal_time!.slice(0, 5),
    }))
    .sort((a, b) => a.time.localeCompare(b.time));
}
