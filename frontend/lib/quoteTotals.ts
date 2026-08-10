// Pure helpers for the quote editor — mirror the backend so totals can be
// previewed live while editing, and so the whole quote saves in one PATCH.
// The server (bookings/models/quotes.py: recalculate_totals + QuoteLineItem.save)
// remains the source of truth on save.
import { EventMealData, CourseData, MenuChoices } from "@/lib/api";
import type { TimelineEntryValue } from "@/components/BookingTimelineField";
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
/** A meal for count derivation — its audience picks who it serves (REL-426). */
export interface MealAudienceInput {
  guest_count: number;
  audience?: string;               // custom | everyone | guests | segment (default custom)
  audience_segment?: string | null; // segment NAME when audience=segment
}

/**
 * The guest count a meal serves — mirror of the backend `derive_meal_guest_count`.
 * ``custom`` (or a meal with no audience) keeps its typed ``guest_count``; the others
 * derive it from the booking's resolved segments (the same rows the save writes).
 */
export function deriveMealCount(
  meal: MealAudienceInput,
  guestCount: number,
  segmentCounts: Record<string, number>,
  meta: GuestSegmentMeta[],
): number {
  const audience = meal.audience || "custom";
  if (audience === "custom") return meal.guest_count || 0;
  return deriveMealCountFromRows(audience, meal.audience_segment, resolvedSegmentRows(guestCount, segmentCounts, meta));
}

/** The derived-audience core over already-resolved segment rows — the exact mirror of
 * the backend `derive_meal_guest_count` (both run the shared `meal_audience_cases`).
 * ``custom`` has no row-derived value (the caller keeps the typed count). */
export function deriveMealCountFromRows(
  audience: string,
  audienceSegment: string | null | undefined,
  rows: { name: string; count: number; counts: boolean }[],
): number {
  if (audience === "everyone") return rows.reduce((t, r) => t + r.count, 0);
  if (audience === "guests") return rows.reduce((t, r) => t + (r.counts ? r.count : 0), 0);
  if (audience === "segment") {
    if (!audienceSegment) return 0;
    return rows.filter((r) => r.name === audienceSegment).reduce((t, r) => t + r.count, 0);
  }
  return 0;
}

/** The segment rows a save would write — mirror of the backend `resolve_booking_segments`:
 * the explicit in-count segments + the derived default remainder + additional covers,
 * or (no breakdown) the whole count under the default segment. */
function resolvedSegmentRows(
  guestCount: number,
  explicit: Record<string, number>,
  meta: GuestSegmentMeta[],
): { name: string; count: number; counts: boolean }[] {
  const byName: Record<string, GuestSegmentMeta> = Object.fromEntries(meta.map((m) => [m.name, m]));
  const built = buildGuestCountsPayload(guestCount, explicit, meta);
  if (built.length === 0) {
    const def = meta.find((m) => m.is_default && m.counts_toward_total);
    return (guestCount || 0) > 0 ? [{ name: def?.name ?? "", count: guestCount, counts: true }] : [];
  }
  return built.map((r) => ({ name: r.segment, count: r.count, counts: !!byName[r.segment]?.counts_toward_total }));
}

/** The effective guest count of a meal (derived for audience meals, typed for custom). */
function effectiveMealCount(
  meal: MealAudienceInput,
  guestCount?: number,
  segmentCounts?: Record<string, number>,
  meta?: GuestSegmentMeta[],
): number {
  if (meta && guestCount != null) return deriveMealCount(meal, guestCount, segmentCounts || {}, meta);
  return meal.guest_count || 0;
}

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
    if (price > 0 && count) total += round2(price * count);
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

export interface GuestSegmentMeta {
  name: string;
  is_default: boolean;
  counts_toward_total: boolean;
  price_multiplier: string; // decimal string, e.g. "0.5000"
  sort_order: number;
}

export interface GuestCountRow {
  segment: string;
  count: number;
  price_per_head?: string; // per-segment per-head override (flat/custom rate); omitted when unset
}

/**
 * The guest_counts payload for a booking save: `[]` when no breakdown was entered
 * (the whole count is the org's default segment), otherwise every explicit in-count
 * segment plus the **derived default remainder** plus any additional-cover segments.
 * `explicit` is the map of user-entered segment counts (the default is never entered
 * — it is the remainder). Mirrors the backend write path.
 */
export function buildGuestCountsPayload(
  guestCount: number,
  explicit: Record<string, number>,
  meta: GuestSegmentMeta[],
  prices: Record<string, string> = {},
): GuestCountRow[] {
  const inCountNonDefault = meta.filter((m) => m.counts_toward_total && !m.is_default);
  const additional = meta.filter((m) => !m.counts_toward_total);
  const anyExplicit = [...inCountNonDefault, ...additional].some((m) => (explicit[m.name] || 0) > 0);
  if (!anyExplicit) return [];
  const row = (segment: string, count: number): GuestCountRow => {
    const p = prices[segment];
    return p != null && p !== "" ? { segment, count, price_per_head: p } : { segment, count };
  };
  const rows: GuestCountRow[] = [];
  let sumInCount = 0;
  for (const m of inCountNonDefault) {
    const c = explicit[m.name] || 0;
    if (c > 0) {
      rows.push(row(m.name, c));
      sumInCount += c;
    }
  }
  const def = meta.find((m) => m.is_default && m.counts_toward_total);
  const remainder = (guestCount || 0) - sumInCount;
  if (def && remainder > 0) rows.push({ segment: def.name, count: remainder }); // default uses base rate
  for (const m of additional) {
    const c = explicit[m.name] || 0;
    if (c > 0) rows.push(row(m.name, c));
  }
  return rows;
}

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

/** The derived remainder shown (read-only) for the org's default segment. */
export function defaultSegmentRemainder(
  guestCount: number,
  explicit: Record<string, number>,
  meta: GuestSegmentMeta[],
): number {
  const sumInCount = meta
    .filter((m) => m.counts_toward_total && !m.is_default)
    .reduce((t, m) => t + (explicit[m.name] || 0), 0);
  return (guestCount || 0) - sumInCount;
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
  const rows = resolved
    .filter((r) => r.count > 0)
    // Order by the org's segment order so the display matches the PDF/backend
    // (which read rows ordered by sort_order), not the payload's explicit-then-default order.
    .sort((a, b) => (byName[a.name]?.sort_order ?? 0) - (byName[b.name]?.sort_order ?? 0))
    .map((r) => {
      // A default (Adults) segment never carries an override; others may.
      const isDefault = byName[r.name]?.is_default && byName[r.name]?.counts_toward_total;
      const rate = segmentEffectiveRate(pricePerHead, r.mult, isDefault ? undefined : prices[r.name]);
      return { name: r.name, count: r.count, rate, amount: round2(rate * r.count) };
    });
  const distinctRates = new Set(rows.map((r) => r.rate));
  if (!rows.some((r) => r.rate > 0) || rows.length < 2 || distinctRates.size < 2) return null;
  return rows;
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

export interface QuoteEditData {
  primary_contact: string;
  is_b2b: boolean;
  account: string;
  event_date: string;
  guest_count: number;
  segment_counts: Record<string, number>; // explicit per-segment inputs (default derived)
  segment_prices: Record<string, string>; // per-segment per-head overrides (blank = use multiplier)
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

/** A booking's additional meals as read-only timeline rows.
 *
 * Derived on every render rather than copied into entries: the meal owns its
 * time (along with its price and menu), so moving the meal moves the row and the
 * two can never disagree. Untimed meals are left out — they aren't a moment yet.
 */
export function timelineMealRows(
  meals: { label?: string; meal_time?: string | null }[] | undefined,
): { label: string; time: string; date: string | null }[] {
  return (meals || [])
    .filter((m) => m.meal_time)
    .map((m) => ({
      label: m.label?.trim() || "Additional meal",
      time: m.meal_time!.includes("T") ? m.meal_time!.slice(11, 16) : m.meal_time!.slice(0, 5),
      // The DAY the meal falls on, kept rather than thrown away (REL-447). A meal
      // is stored as a full datetime, so a 2am late-night snack belongs to the day
      // AFTER the event — the backend sorts on (date, time) and would place it
      // last. Slicing to "HH:MM" alone made it sort FIRST on screen, contradicting
      // the PDF the customer is holding.
      date: m.meal_time!.includes("T") ? m.meal_time!.slice(0, 10) : null,
    }))
    .sort((a, b) => ((a.date || "") + a.time).localeCompare((b.date || "") + b.time));
}

/** Serialize a booking's run-of-show for a save (quote OR event).
 *
 * Rows go out in the order they're shown — the backend turns that position into
 * `sort_order`, so "the order I arranged" is what persists. Rows with no time
 * are dropped: a step without a time isn't a step yet.
 *
 * An empty array is meaningful and IS sent: it clears the timeline and the
 * booking falls back to its four legacy time fields.
 */
export function buildTimelineEntriesPayload(entries: TimelineEntryValue[] = []) {
  return entries
    .filter((e) => e.time)
    .map((e) => ({
      time: e.time.length === 5 ? `${e.time}:00` : e.time,
      label: e.label.trim(),
      // null, not omitted: a row moved back onto the event day has to clear the
      // date it used to carry.
      date: e.date || null,
    }));
}

/** Serialize additional meals for a booking save (quote OR event). Sends the meal's
 * audience; ``guest_count`` is the effective count (derived for audience meals, typed
 * for custom) — the backend re-derives and dual-writes it, this keeps the payload
 * consistent for a stale-count-free save. */
export function buildMealsPayload(
  meals: EventMealData[],
  guestCount?: number,
  segmentCounts?: Record<string, number>,
  meta?: GuestSegmentMeta[],
) {
  return meals.map((m) => {
    const audience = m.audience || "custom";
    return {
      label: m.label,
      audience,
      audience_segment: audience === "segment" ? (m.audience_segment ?? null) : null,
      guest_count: effectiveMealCount(m, guestCount, segmentCounts, meta),
      price_per_head: m.price_per_head || null,
      dish_ids: m.dishes,
      based_on_template: m.based_on_template,
      meal_time: m.meal_time || null,
      notes: m.notes,
    };
  });
}

export function buildQuoteSavePayload(
  editData: QuoteEditData,
  menuData: QuoteMenuData,
  lineItems: LineItemInput[],
  meals: EventMealData[] = [],
  segmentMeta: GuestSegmentMeta[] = [],
  timelineEntries: TimelineEntryValue[] = [],
  courses: CourseData[] = [],
  dishCourses: Record<string, number> = {},
  menuChoices: MenuChoices = {},
) {
  return {
    primary_contact: editData.primary_contact ? Number(editData.primary_contact) : null,
    is_b2b: editData.is_b2b,
    account: editData.is_b2b && editData.account ? Number(editData.account) : null,
    event_date: editData.event_date,
    guest_counts: buildGuestCountsPayload(editData.guest_count, editData.segment_counts, segmentMeta, editData.segment_prices),
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
    courses,
    dish_courses: dishCourses,
    // Which dishes are offered as an entrée choice (REL-419). Always sent so
    // un-ticking the last one clears it; the counts stay null until finals.
    menu_choices: menuChoices,
    line_items: buildLineItemsPayload(lineItems),
    additional_meals: buildMealsPayload(meals, editData.guest_count, editData.segment_counts, segmentMeta),
    timeline_entries: buildTimelineEntriesPayload(timelineEntries),
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
  segment_counts: Record<string, number>; // explicit per-segment inputs (default derived)
  segment_prices: Record<string, string>; // per-segment per-head overrides (blank = use multiplier)
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
  timeline_entries: TimelineEntryValue[];
}

export function buildEventSavePayload(
  v: EventSaveInput,
  segmentMeta: GuestSegmentMeta[] = [],
  courses: CourseData[] = [],
  dishCourses: Record<string, number> = {},
  menuChoices: MenuChoices = {},
) {
  return {
    name: v.name,
    date: v.date,
    courses,
    dish_courses: dishCourses,
    // Offered entrée choices (REL-419), `{dish_id: tally or null}`. The finals panel
    // owns the tallies, but they ride along here UNCHANGED — the map is authoritative
    // server-side, so dropping them from an ordinary event save would wipe recorded
    // finals. The editor never edits a count, only which dishes are offered.
    menu_choices: menuChoices,
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
    guest_counts: buildGuestCountsPayload(v.guest_count, v.segment_counts, segmentMeta, v.segment_prices),
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
    additional_meals: buildMealsPayload(v.meals, v.guest_count, v.segment_counts, segmentMeta),
    timeline_entries: buildTimelineEntriesPayload(v.timeline_entries),
  };
}
