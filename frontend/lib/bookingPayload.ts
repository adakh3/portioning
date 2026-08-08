// What a booking SENDS — the shape of a save, for quotes and events alike.
//
// Deliberately separate from the money math: these builders decide which fields
// go in the request body and how the form's strings are spelled on the wire, and
// none of them works out what anything costs. That is the pricing engine's job,
// and since REL-465 the frontend asks the server for it rather than
// re-implementing it (`usePricingPreview`). Keeping the two apart is what lets
// the mirrored arithmetic in `quoteTotals.ts` be deleted without taking the save
// path with it.
import { EventMealData, CourseData, MenuChoices } from "@/lib/api";
import type { TimelineEntryValue } from "@/components/BookingTimelineField";

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

// ── Tax rate: percent in the form, fraction on the wire ──
//
// The form holds a PERCENT string ("8.5") because that is what the user types and
// reads; the API stores a FRACTION ("0.0850"). Both conversions live here and
// nowhere else.
//
// They used to be scattered: a create form that kept the fraction in state while
// displaying percent, an edit form that kept percent, and four hand-written
// `* 100` / `/ 100` sites between them. That is how a quote could be hydrated at
// 8.5% and saved at 850% — each site was correct about its own half and no site
// owned the convention. One pair of functions, one convention, one place to be
// wrong.

/** Digits after the point in the stored fraction — three decimals of PERCENT.
 *
 * Five, not four, because 8.875% is New York City's real rate and four decimals of
 * fraction cannot hold it: it became 8.87% or 8.88%, quietly, on every NYC
 * booking. Matches `DecimalField(max_digits=6, decimal_places=5)` on both tax_rate
 * columns — the wire format and the column agree, so nothing is rounded in
 * transit. */
const TAX_FRACTION_DP = 5;

/** Form percent ("8.875") → stored fraction ("0.08875"). The only place this happens. */
export function taxRateFraction(percent: string | number | null | undefined): string {
  const n = parseFloat(String(percent ?? "")) || 0;
  return (n / 100).toFixed(TAX_FRACTION_DP);
}

/** Stored fraction ("0.08875") → form percent ("8.875"). The only place this happens.
 *
 * Rounded to the three decimals of percent the column can hold: `0.0850 * 100` in
 * binary floating point is `8.500000000000001`, which is not a thing anyone wants
 * to see in a tax field. */
export function taxRatePercent(fraction: string | number | null | undefined): string {
  const n = parseFloat(String(fraction ?? "")) || 0;
  return String(Math.round(n * 100 * 1000) / 1000);
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
export function resolvedSegmentRows(
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
export function effectiveMealCount(
  meal: MealAudienceInput,
  guestCount?: number,
  segmentCounts?: Record<string, number>,
  meta?: GuestSegmentMeta[],
): number {
  if (meta && guestCount != null) return deriveMealCount(meal, guestCount, segmentCounts || {}, meta);
  return meal.guest_count || 0;
}

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

/** Everything `POST /api/pricing/preview` reads, and nothing else.
 *
 * Takes a SAVE payload and narrows it. That direction matters: the preview is by
 * construction a subset of what the save sends, so "what the card shows" and
 * "what the server stores" cannot be fed different numbers — which is the entire
 * failure this endpoint exists to prevent (AC1).
 *
 * Narrowing rather than passing the whole body keeps the request tied to price:
 * the draft is the preview hook's cache key, so sending the notes field too would
 * re-price the booking on every keystroke of a customer note.
 *
 * QUOTES ONLY for now. A quote carries `tax_rate`; an event carries `is_taxable`
 * and no rate at all, and the endpoint reads the rate from the payload — so an
 * event-shaped draft prices at ZERO tax rather than at the event's own rate. The
 * `is_taxable` branch below is therefore not yet a working event preview: wiring
 * the event page (step 4) has to send the rate too, or teach the endpoint to read
 * it from the booking. Pinned by a test so the gap cannot be discovered in prod.
 */
export function pricingDraft(payload: Record<string, unknown>) {
  const draft: Record<string, unknown> = {
    price_per_head: payload.price_per_head ?? null,
    guest_count: payload.guest_count ?? 0,
    guest_counts: payload.guest_counts ?? [],
    additional_meals: payload.additional_meals ?? [],
    line_items: payload.line_items ?? [],
    service_charge_pct: payload.service_charge_pct ?? "0",
    service_charge_taxable: payload.service_charge_taxable ?? true,
    gratuity_pct: payload.gratuity_pct ?? "0",
  };
  // Only send the tax key the booking actually has. Sending `is_taxable:
  // undefined` alongside a rate would read as "not taxable" on the server, which
  // silently zeroes the tax line on every quote.
  if ("tax_rate" in payload) draft.tax_rate = payload.tax_rate;
  if ("is_taxable" in payload) draft.is_taxable = payload.is_taxable;
  return draft;
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
 *
 * Used by BOTH create and edit. Create used to assemble its own object literal,
 * which is how it came to send raw line items where edit sent serialized ones,
 * and a tax fraction where edit sent a converted percent. One builder, one body.
 */
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
    tax_rate: taxRateFraction(editData.tax_rate),
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
