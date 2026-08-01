import {
  computeBookingTotals,
  lineItemTotal,
  buildGuestCountsPayload,
  deriveMealCount,
  mealsFood,
  segmentFood,
  type GuestSegmentMeta,
  type LineItemInput,
} from "./quoteTotals";

// The frontend mirror is what the user watches while typing, so it has to hold
// up under the same abuse the API was probed with. The shared golden cases in
// docs/calculation-golden-cases.json already pin the two engines against each
// other on the *arithmetic*; this file covers the frontend-only helpers and the
// hostile/degenerate inputs a form can produce (NaN from an emptied number
// field, negative values, missing keys) which the backend never sees because it
// rejects them at the API.

const item = (o: Partial<LineItemInput>): LineItemInput => ({
  category: "food", description: "x", quantity: 1, unit: "each", unit_price: 0, ...o,
});

const SEGMENTS: GuestSegmentMeta[] = [
  { name: "Adults", is_default: true, counts_toward_total: true, price_multiplier: "1.0000", sort_order: 0 },
  { name: "Kids", is_default: false, counts_toward_total: true, price_multiplier: "0.5000", sort_order: 1 },
  { name: "Vendors", is_default: false, counts_toward_total: false, price_multiplier: "1.0000", sort_order: 2 },
];

describe("lineItemTotal — degenerate inputs", () => {
  it("per_guest with zero guests is zero, not NaN", () => {
    expect(lineItemTotal(item({ unit: "per_guest", unit_price: 10 }), 0)).toBe(0);
  });

  it("a discount is always negative, however it was typed", () => {
    expect(lineItemTotal(item({ category: "discount", unit: "flat", quantity: 1, unit_price: 500 }), 10)).toBe(-500);
    // Already-negative input must not double-negate into a charge.
    expect(lineItemTotal(item({ category: "discount", unit: "flat", quantity: 1, unit_price: -500 }), 10)).toBe(-500);
  });

  it("empty-string and non-numeric fields coerce to zero rather than NaN", () => {
    // An emptied number input hands back "" — the preview must not print NaN.
    expect(lineItemTotal(item({ quantity: "" as unknown as number, unit_price: "" as unknown as number }), 10)).toBe(0);
    expect(lineItemTotal(item({ quantity: "abc" as unknown as number, unit_price: 10 }), 10)).toBe(0);
    expect(Number.isNaN(lineItemTotal(item({ unit_price: NaN }), 10))).toBe(false);
  });

  it("zero quantity is zero", () => {
    expect(lineItemTotal(item({ quantity: 0, unit_price: 99 }), 10)).toBe(0);
  });
});

describe("computeBookingTotals — degenerate inputs", () => {
  it("an empty booking is all zeros, never NaN", () => {
    const t = computeBookingTotals(0, [], 0, 0);
    expect(t).toMatchObject({ subtotal: 0, service_charge: 0, tax_amount: 0, gratuity: 0, total: 0 });
  });

  it("NaN food does not poison the total", () => {
    const t = computeBookingTotals(NaN, [], 0, 0.2);
    expect(Number.isNaN(t.total)).toBe(false);
    expect(t.total).toBe(0);
  });

  it("percentage charges are never taken on a negative subtotal", () => {
    // Mirrors charge_base in the backend engine: an over-large discount must not
    // flip the service charge and gratuity negative and compound the error.
    const t = computeBookingTotals(5000, [item({ category: "discount", unit: "flat", quantity: 1, unit_price: 100000 })], 0, 0, 20, true, 10);
    expect(t.subtotal).toBe(-95000);
    expect(t.service_charge).toBe(0);
    expect(t.gratuity).toBe(0);
  });

  it("a legitimate discount still shrinks the charge base", () => {
    const t = computeBookingTotals(5000, [item({ category: "discount", unit: "flat", quantity: 1, unit_price: 1000 })], 0, 0, 20);
    expect(t.subtotal).toBe(4000);
    expect(t.service_charge).toBe(800);
  });

  it("rounds half-up on a .005 boundary, matching the backend", () => {
    // The exact divergence that made the preview say 105.11 and the saved value
    // 105.10 — Decimal's default is half-EVEN, Math.round is half-UP.
    expect(computeBookingTotals(100.1, [], 0, 0.05).tax_amount).toBe(5.01);
    expect(computeBookingTotals(100.1, [], 0, 0, 5).service_charge).toBe(5.01);
    expect(computeBookingTotals(100.1, [], 0, 0, 0, true, 5).gratuity).toBe(5.01);
  });

  it("a non-taxable service charge stays out of the tax base", () => {
    const t = computeBookingTotals(1000, [], 0, 0.1, 20, false, 0);
    expect(t.service_charge).toBe(200);
    expect(t.tax_base).toBe(1000);
    expect(t.tax_amount).toBe(100);
  });
});

describe("buildGuestCountsPayload — boundaries", () => {
  it("no breakdown sends nothing at all", () => {
    expect(buildGuestCountsPayload(100, {}, SEGMENTS)).toEqual([]);
  });

  it("a breakdown equal to the guest count omits the empty default segment", () => {
    // The backend does the same (resolve_booking_segments returns Kids only), so
    // an "everyone" meal still derives 100 — the two engines agree on the shape.
    const rows = buildGuestCountsPayload(100, { Kids: 100 }, SEGMENTS);
    expect(rows.find((r) => r.segment === "Adults")).toBeUndefined();
    expect(rows.find((r) => r.segment === "Kids")?.count).toBe(100);
  });

  it("the default segment is the remainder, never typed", () => {
    const rows = buildGuestCountsPayload(100, { Kids: 30 }, SEGMENTS);
    expect(rows.find((r) => r.segment === "Adults")?.count).toBe(70);
  });

  it("additional covers sit outside the guest count", () => {
    const rows = buildGuestCountsPayload(100, { Vendors: 8 }, SEGMENTS);
    expect(rows.find((r) => r.segment === "Adults")?.count).toBe(100);
    expect(rows.find((r) => r.segment === "Vendors")?.count).toBe(8);
  });

  it("a zero guest count with no breakdown produces nothing", () => {
    expect(buildGuestCountsPayload(0, {}, SEGMENTS)).toEqual([]);
  });
});

describe("deriveMealCount — degenerate inputs", () => {
  const meal = (audience: string, seg?: string | null, guest_count = 0) =>
    ({ audience, audience_segment: seg ?? null, guest_count });

  it("a segment audience with no segment chosen serves nobody", () => {
    expect(deriveMealCount(meal("segment", null), 100, { Kids: 20 }, SEGMENTS)).toBe(0);
  });

  it("a segment that is not on this booking serves nobody", () => {
    expect(deriveMealCount(meal("segment", "Vendors"), 100, {}, SEGMENTS)).toBe(0);
  });

  it("zero guests derives zero for every audience", () => {
    for (const a of ["everyone", "guests"]) {
      expect(deriveMealCount(meal(a), 0, {}, SEGMENTS)).toBe(0);
    }
  });

  it("an unknown audience string does not throw or invent covers", () => {
    expect(deriveMealCount(meal("nonsense"), 100, {}, SEGMENTS)).toBe(0);
  });

  it("custom keeps the typed count even when it is zero", () => {
    expect(deriveMealCount(meal("custom", null, 0), 100, {}, SEGMENTS)).toBe(0);
    expect(deriveMealCount(meal("custom", null, 42), 100, {}, SEGMENTS)).toBe(42);
  });
});

describe("mealsFood / segmentFood — degenerate inputs", () => {
  it("an unpriced meal costs nothing", () => {
    expect(mealsFood([{ guest_count: 50, price_per_head: null, audience: "custom" }])).toBe(0);
  });

  it("a priced meal serving nobody costs nothing", () => {
    expect(mealsFood([{ guest_count: 0, price_per_head: "25", audience: "custom" }])).toBe(0);
  });

  it("undefined meals is zero, not NaN", () => {
    expect(mealsFood(undefined)).toBe(0);
  });

  it("segment food with no segment metadata falls back to price x guests", () => {
    // Documented reduction: with no breakdown the whole count sits under the
    // org's default segment at 1.0x, so this must equal the flat calculation.
    expect(segmentFood(50, 100, {}, [], {})).toBe(5000);
  });
});
