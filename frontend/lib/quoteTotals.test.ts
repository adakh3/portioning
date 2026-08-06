import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { resolve } from "path";
import { computeQuoteTotals, computeBookingTotals, buildQuoteSavePayload, buildEventSavePayload, EventSaveInput, lineItemTotal, LineItemInput, segmentFood, segmentFoodFromRows, segmentFoodRows, segmentEffectiveRate, buildGuestCountsPayload, hasVendorDoubleEntry, deriveMealCount, deriveMealCountFromRows, mealsFood, buildMealsPayload, GuestSegmentMeta } from "./quoteTotals";

// Adults(default)/Kids(0.5)/Vendors(0.5, additional covers) — mirrors the backend
// segment_food_total fixture in bookings/test_segment_pricing.py (AC10/AC11).
const SEG_META: GuestSegmentMeta[] = [
  { name: "Adults", is_default: true, counts_toward_total: true, price_multiplier: "1.0000", sort_order: 0 },
  { name: "Kids", is_default: false, counts_toward_total: true, price_multiplier: "0.5000", sort_order: 1 },
  { name: "Vendors", is_default: false, counts_toward_total: false, price_multiplier: "0.5000", sort_order: 2 },
];

describe("deriveMealCount (mirror of backend derive_meal_guest_count) — REL-426", () => {
  // 138 Adults (default remainder) + 12 Kids (=150 guests) + 8 Vendors = 158 covers.
  const counts = { Kids: 12, Vendors: 8 };
  const meal = (audience: string, seg?: string | null, guest_count = 0) =>
    ({ audience, audience_segment: seg ?? null, guest_count });

  it("everyone = guests + extra covers", () => {
    expect(deriveMealCount(meal("everyone"), 150, counts, SEG_META)).toBe(158);
  });
  it("guests only excludes extra covers", () => {
    expect(deriveMealCount(meal("guests"), 150, counts, SEG_META)).toBe(150);
  });
  it("a single segment is that segment's count (incl. the derived default remainder)", () => {
    expect(deriveMealCount(meal("segment", "Vendors"), 150, counts, SEG_META)).toBe(8);
    expect(deriveMealCount(meal("segment", "Adults"), 150, counts, SEG_META)).toBe(138);
    expect(deriveMealCount(meal("segment", "Kids"), 150, counts, SEG_META)).toBe(12);
  });
  it("a segment not in the mix serves zero", () => {
    expect(deriveMealCount(meal("segment", "Vendors"), 150, {}, SEG_META)).toBe(0);
  });
  it("custom keeps the typed count", () => {
    expect(deriveMealCount(meal("custom", null, 42), 150, counts, SEG_META)).toBe(42);
  });
  it("no breakdown: everyone reduces to the bare guest count", () => {
    expect(deriveMealCount(meal("everyone"), 150, {}, SEG_META)).toBe(150);
  });

  it("mealsFood + buildMealsPayload price and serialize by the derived count", () => {
    const meals = [
      { label: "Dinner", audience: "everyone", audience_segment: null, guest_count: 0, price_per_head: "20", dishes: [] },
      { label: "Crew", audience: "segment", audience_segment: "Vendors", guest_count: 0, price_per_head: "5", dishes: [] },
    ];
    // 20×158 + 5×8 = 3160 + 40.
    expect(mealsFood(meals, 150, counts, SEG_META)).toBe(3200);
    const payload = buildMealsPayload(meals as never, 150, counts, SEG_META);
    expect(payload[0]).toMatchObject({ label: "Dinner", audience: "everyone", audience_segment: null, guest_count: 158 });
    expect(payload[1]).toMatchObject({ label: "Crew", audience: "segment", audience_segment: "Vendors", guest_count: 8 });
  });
});

describe("segmentFood (mirror of backend segment_food_total)", () => {
  it("no breakdown reduces to price × guest_count", () => {
    expect(segmentFood("10", 150, {}, SEG_META)).toBe(1500);
  });
  it("AC10: kids priced by their multiplier (138×10 + 12×5 = 1440)", () => {
    expect(segmentFood("10", 150, { Kids: 12 }, SEG_META)).toBe(1440);
  });
  it("AC11: vendor additional covers add at their multiplier (+8×5 = 1480)", () => {
    expect(segmentFood("10", 150, { Kids: 12, Vendors: 8 }, SEG_META)).toBe(1480);
  });
  it("zero price is zero", () => {
    expect(segmentFood("0", 150, { Kids: 12 }, SEG_META)).toBe(0);
  });
  it("half-cent amounts round half-up (matches the backend, not banker's)", () => {
    // 1.01 × 0.5 × 1 = 0.505 → 0.51, matching segment_food_total's ROUND_HALF_UP.
    expect(segmentFood("1.01", 1, { Kids: 1 }, SEG_META)).toBe(0.51);
  });
});

describe("segmentFoodRows (itemized display) + segmentEffectiveRate", () => {
  it("per-cover rate = round(price × multiplier)", () => {
    expect(segmentEffectiveRate("10", "0.5")).toBe(5);
    expect(segmentEffectiveRate("10", "1.0")).toBe(10);
  });
  it("itemizes multi-rate; amounts sum to segmentFood", () => {
    const rows = segmentFoodRows("10", 150, { Kids: 12, Vendors: 8 }, SEG_META)!;
    expect(rows.map((r) => [r.name, r.count, r.rate, r.amount])).toEqual([
      ["Adults", 138, 10, 1380],
      ["Kids", 12, 5, 60],
      ["Vendors", 8, 5, 40],
    ]);
    // The itemized amounts sum EXACTLY to the subtotal food (parity with backend).
    expect(rows.reduce((t, r) => t + r.amount, 0)).toBe(segmentFood("10", 150, { Kids: 12, Vendors: 8 }, SEG_META));
  });
  it("honours a per-segment price override; default + others unchanged", () => {
    const rows = segmentFoodRows("10", 150, { Kids: 12, Vendors: 8 }, SEG_META, { Kids: "18" })!;
    expect(rows.find((r) => r.name === "Kids")).toMatchObject({ rate: 18, amount: 216 });
    expect(rows.find((r) => r.name === "Adults")!.rate).toBe(10); // base, no override
    expect(rows.find((r) => r.name === "Vendors")!.rate).toBe(5); // 0.5 × 10
    // 138×10 + 12×18 + 8×5 = 1636.
    expect(segmentFood("10", 150, { Kids: 12, Vendors: 8 }, SEG_META, { Kids: "18" })).toBe(1636);
  });
  it("buildGuestCountsPayload carries a segment override; the default never does", () => {
    const rows = buildGuestCountsPayload(150, { Kids: 12 }, SEG_META, { Kids: "18", Adults: "99" });
    expect(rows.find((r) => r.segment === "Kids")).toEqual({ segment: "Kids", count: 12, price_per_head: "18" });
    expect(rows.find((r) => r.segment === "Adults")).toEqual({ segment: "Adults", count: 138 });
  });

  it("null for a single shared rate (gents/ladies) or a count-only booking", () => {
    const GL: GuestSegmentMeta[] = [
      { name: "Gents", is_default: true, counts_toward_total: true, price_multiplier: "1.0000", sort_order: 0 },
      { name: "Ladies", is_default: false, counts_toward_total: true, price_multiplier: "1.0000", sort_order: 1 },
    ];
    expect(segmentFoodRows("10", 100, { Ladies: 40 }, GL)).toBeNull();
    expect(segmentFoodRows("10", 150, {}, SEG_META)).toBeNull();
  });
});

describe("buildGuestCountsPayload", () => {
  it("empty when no breakdown entered", () => {
    expect(buildGuestCountsPayload(150, {}, SEG_META)).toEqual([]);
  });
  it("explicit + derived default + covers", () => {
    expect(buildGuestCountsPayload(150, { Kids: 12, Vendors: 8 }, SEG_META)).toEqual([
      { segment: "Kids", count: 12 },
      { segment: "Adults", count: 138 },
      { segment: "Vendors", count: 8 },
    ]);
  });
});

describe("hasVendorDoubleEntry (AC14)", () => {
  it("warns only when both a vendor cover count and a vendor-labelled meal exist", () => {
    expect(hasVendorDoubleEntry({ Vendors: 8 }, [{ label: "Vendor meals" }], SEG_META)).toBe(true);
    expect(hasVendorDoubleEntry({ Vendors: 8 }, [{ label: "Kids buffet" }], SEG_META)).toBe(false);
    expect(hasVendorDoubleEntry({ Vendors: 0 }, [{ label: "Vendor meals" }], SEG_META)).toBe(false);
  });
});

const item = (over: Partial<LineItemInput>): LineItemInput => ({
  category: "rental",
  description: "x",
  quantity: 1,
  unit: "each",
  unit_price: 0,
  ...over,
});

describe("computeQuoteTotals", () => {
  it("food only (price × guests) goes into subtotal", () => {
    expect(computeQuoteTotals(50, 100, 0, [])).toEqual({
      food_total: 5000, subtotal: 5000, service_charge: 0, tax_base: 5000,
      tax_amount: 0, gratuity: 0, total: 5000,
    });
  });

  it("applies tax to the whole subtotal", () => {
    expect(computeQuoteTotals(50, 100, 0.2, [])).toEqual({
      food_total: 5000, subtotal: 5000, service_charge: 0, tax_base: 5000,
      tax_amount: 1000, gratuity: 0, total: 6000,
    });
  });

  it("line items only, no per-head price", () => {
    const t = computeQuoteTotals(0, 100, 0, [
      item({ unit: "each", quantity: 10, unit_price: 5 }),
    ]);
    expect(t).toEqual({
      food_total: 0, subtotal: 50, service_charge: 0, tax_base: 50,
      tax_amount: 0, gratuity: 0, total: 50,
    });
  });

  it("taxes the whole subtotal (no per-line taxable split)", () => {
    const t = computeQuoteTotals(0, 50, 0.1, [
      item({ unit: "flat", quantity: 1, unit_price: 200 }),
      item({ unit: "flat", quantity: 1, unit_price: 100 }),
    ]);
    // subtotal 300; tax = 10% of 300 = 30; total 330
    expect(t).toEqual({
      food_total: 0, subtotal: 300, service_charge: 0, tax_base: 300,
      tax_amount: 30, gratuity: 0, total: 330,
    });
  });

  it("per_guest unit multiplies by guest count", () => {
    expect(lineItemTotal(item({ unit: "per_guest", unit_price: 12.5 }), 50)).toBe(625);
  });

  it("per_hour unit is quantity × price (hours × rate, not scaled by guests)", () => {
    expect(lineItemTotal(item({ unit: "per_hour", quantity: 6, unit_price: 18 }), 50)).toBe(108);
  });

  it("discount line is negative and reduces the taxed subtotal", () => {
    expect(
      lineItemTotal(item({ category: "discount", unit: "flat", quantity: 1, unit_price: 100 }), 10),
    ).toBe(-100);
  });

  // The half-cent is the ONLY input that can tell the two engines apart: JS
  // Math.round is half-up, and Python's bare `.quantize()` is half-EVEN. The
  // backend stored $0.04 here while this preview showed $0.05 (REL-462 Bug 2).
  // These numbers are the same ones asserted in
  // backend/bookings/test_money_bleeding.py::HalfCentRoundingTests — change one
  // side and the two stop agreeing to the cent.
  it("a half-cent line rounds up, matching the stored backend value", () => {
    expect(lineItemTotal(item({ unit: "each", quantity: 1.5, unit_price: 0.03 }), 10)).toBe(0.05);
    expect(
      lineItemTotal(item({ unit: "per_hour", quantity: 2.5, unit_price: 16.97 }), 10),
    ).toBe(42.43);
  });

  it("a half-cent discount rounds away from zero, matching the backend", () => {
    expect(
      lineItemTotal(item({ category: "discount", unit: "flat", quantity: 2.5, unit_price: 16.97 }), 10),
    ).toBe(-42.43);
  });

  it("zero/blank price yields no food cost", () => {
    expect(computeQuoteTotals("", 100, 0.2, []).food_total).toBe(0);
  });
});

// Shared cross-language spec — the SAME file is loaded by the backend engine's
// tests (backend/bookings/test_totals.py). See docs/CALCULATION_PARITY.md.
const golden = JSON.parse(
  // Vitest runs with cwd = frontend/, so the repo-root docs dir is one up.
  readFileSync(resolve(process.cwd(), "../docs/calculation-golden-cases.json"), "utf-8"),
) as {
  cases: {
    name: string;
    food_total: string;
    items: { line_total: string }[];
    tax_rate: string;
    service_charge_pct?: string;
    service_charge_taxable?: boolean;
    gratuity_pct?: string;
    expected: {
      subtotal: string; tax_amount: string; total: string;
      service_charge?: string; tax_base?: string; gratuity?: string;
    };
  }[];
  segment_food_cases: {
    name: string;
    price_per_head: string;
    // `price_override` MUST be in this type. It was missing, and the runtime JSON
    // carried it anyway — so a refactor that mapped these rows would have silently
    // dropped every override while all the override cases still passed (each
    // expects the ignored-override value). The type is part of the parity contract.
    segments: { count: number; price_multiplier: string; price_override?: string }[];
    expected_food: string;
  }[];
  meal_audience_cases: {
    name: string;
    segments: { name: string; count: number; counts_toward_total: boolean }[];
    audience: string;
    audience_segment: string | null;
    expected: number;
  }[];
};

describe("golden-case parity with the backend engine", () => {
  // Each precomputed line_total is fed as a flat qty-1 line so lineItemTotal
  // reproduces it; the frontend engine must then match the backend's expected.
  for (const c of golden.cases) {
    it(c.name, () => {
      const items: LineItemInput[] = c.items.map((i) => ({
        category: "fee", description: "x", quantity: 1, unit: "flat",
        unit_price: Number(i.line_total),
      }));
      const t = computeBookingTotals(
        Number(c.food_total), items, 0, Number(c.tax_rate),
        Number(c.service_charge_pct ?? 0),
        c.service_charge_taxable ?? true,
        Number(c.gratuity_pct ?? 0),
      );
      expect(t.subtotal).toBeCloseTo(Number(c.expected.subtotal), 2);
      expect(t.tax_amount).toBeCloseTo(Number(c.expected.tax_amount), 2);
      expect(t.total).toBeCloseTo(Number(c.expected.total), 2);
      // Service-charge / gratuity outputs asserted only when the case declares them.
      if (c.expected.service_charge !== undefined)
        expect(t.service_charge).toBeCloseTo(Number(c.expected.service_charge), 2);
      if (c.expected.tax_base !== undefined)
        expect(t.tax_base).toBeCloseTo(Number(c.expected.tax_base), 2);
      if (c.expected.gratuity !== undefined)
        expect(t.gratuity).toBeCloseTo(Number(c.expected.gratuity), 2);
    });
  }

  // Segment-aware food parity — the SAME shared cases the backend
  // test_backend_matches_segment_food_cases runs (REL-415).
  for (const c of golden.segment_food_cases) {
    it(`segment food: ${c.name}`, () => {
      // EXACT (not toBeCloseTo) — a ±0.005 tolerance would mask a 1¢ half-cent
      // rounding-mode divergence, which is exactly the class this locks.
      expect(segmentFoodFromRows(c.price_per_head, c.segments)).toBe(Number(c.expected_food));
    });
  }

  // Meal audience derivation parity — the SAME shared cases the backend
  // test_backend_matches_meal_audience_cases runs (REL-426).
  for (const c of golden.meal_audience_cases) {
    it(`meal audience: ${c.name}`, () => {
      const rows = c.segments.map((s) => ({ name: s.name, count: s.count, counts: s.counts_toward_total }));
      expect(deriveMealCountFromRows(c.audience, c.audience_segment, rows)).toBe(c.expected);
    });
  }
});

describe("computeBookingTotals (shared engine — quotes & events)", () => {
  it("foodTotal already includes meals; tax on the whole subtotal", () => {
    // event-style: food 1000 + meals 300 = 1300 foodTotal, + two add-on lines
    const t = computeBookingTotals(1300, [
      item({ unit: "flat", quantity: 1, unit_price: 200 }),
      item({ unit: "flat", quantity: 1, unit_price: 100 }),
    ], 50, 0.15);
    // subtotal = 1600; tax = 1600 * 0.15 = 240
    expect(t).toEqual({
      food_total: 1300, subtotal: 1600, service_charge: 0, tax_base: 1600,
      tax_amount: 240, gratuity: 0, total: 1840,
    });
  });

  it("passing rate 0 (not taxable) yields no tax", () => {
    const t = computeBookingTotals(1000, [item({ unit: "flat", unit_price: 100 })], 20, 0);
    expect(t).toEqual({
      food_total: 1000, subtotal: 1100, service_charge: 0, tax_base: 1100,
      tax_amount: 0, gratuity: 0, total: 1100,
    });
  });

  it("matches computeQuoteTotals for the same inputs (no meals)", () => {
    const items = [item({ unit: "each", quantity: 10, unit_price: 5 })];
    expect(computeBookingTotals(50 * 100, items, 100, 0.2)).toEqual(
      computeQuoteTotals(50, 100, 0.2, items),
    );
  });
});

describe("buildQuoteSavePayload", () => {
  const editData = {
    primary_contact: "3", is_b2b: false, account: "", event_date: "2026-09-01",
    guest_count: 100, segment_counts: {}, segment_prices: {}, big_eaters: false, big_eaters_percentage: 0,
    price_per_head: "50.00", venue: "", venue_address: "", event_type: "wedding",
    meal_type: "", booking_date: "", service_style: "", product: "",
    setup_time: "", guest_arrival_time: "", meal_time: "", end_time: "",
    tax_rate: "20", service_charge_pct: "0", service_charge_taxable: true, gratuity_pct: "0",
    valid_until: "", notes: "", internal_notes: "",
  };
  const menuData = { dish_ids: [1, 2], based_on_template: null };

  it("carries price_per_head, dish_ids and line_items together in one payload", () => {
    const payload = buildQuoteSavePayload(editData, menuData, [
      item({ id: 7, description: "Keep", unit: "flat", quantity: 2, unit_price: 100 }),
      item({ description: "New", unit: "each", quantity: 5, unit_price: 3 }),
    ]);
    expect(payload.price_per_head).toBe("50.00"); // the regression: menu price now saved
    expect(payload.dish_ids).toEqual([1, 2]);
    expect(payload.tax_rate).toBe("0.2000"); // percent -> decimal
    expect(payload.line_items).toHaveLength(2);
    expect(payload.line_items[0]).toMatchObject({ id: 7, description: "Keep" });
    expect(payload.line_items[1]).not.toHaveProperty("id"); // new row has no id
  });

  it("sends null price when blank", () => {
    const payload = buildQuoteSavePayload({ ...editData, price_per_head: "" }, menuData, []);
    expect(payload.price_per_head).toBeNull();
  });

  it("includes the business only when B2B", () => {
    expect(buildQuoteSavePayload(editData, menuData, []).account).toBeNull();
    const b2b = buildQuoteSavePayload({ ...editData, is_b2b: true, account: "9" }, menuData, []);
    expect(b2b.is_b2b).toBe(true);
    expect(b2b.account).toBe(9);
  });
});

describe("buildEventSavePayload", () => {
  const base: EventSaveInput = {
    name: "Acme — 2026-09-01", date: "2026-09-01",
    is_b2b: false, account: 9, primary_contact: 3,
    venue: null, venue_address: "", event_type: "corporate", meal_type: "lunch",
    booking_date: "", service_style: "buffet", product: null, price_per_head: "50.00", notes: "n",
    kitchen_instructions: "k", banquet_instructions: "b", setup_instructions: "s",
    guest_count: 40, segment_counts: {}, segment_prices: {},
    big_eaters: true, big_eaters_percentage: 30,
    setup_time: "2026-09-01T09:00", guest_arrival_time: "", meal_time: "", end_time: "",
    is_taxable: true, service_charge_pct: "0", service_charge_taxable: true, gratuity_pct: "0",
    dish_ids: [1, 2], based_on_template: null,
    line_items: [{ id: 7, category: "rental", description: "Chairs", quantity: 2, unit: "each", unit_price: 100 }],
    timeline_entries: [],
    meals: [{ label: "Tea", guest_count: 40, price_per_head: "15.00", dishes: [3], based_on_template: null, meal_time: null, notes: "" }],
  };

  it("carries the event-only fields (timeline, counts, instructions)", () => {
    const p = buildEventSavePayload(base);
    expect(p).toMatchObject({
      name: "Acme — 2026-09-01", date: "2026-09-01",
      big_eaters: true, big_eaters_percentage: 30,
      kitchen_instructions: "k", is_taxable: true,
      setup_time: "2026-09-01T09:00",
    });
    // No breakdown entered → no guest_counts rows (whole count is the default).
    expect(p.guest_counts).toEqual([]);
  });

  it("builds guest_counts from the breakdown: explicit segments + derived default + covers", () => {
    const meta: GuestSegmentMeta[] = [
      { name: "Adults", is_default: true, counts_toward_total: true, price_multiplier: "1.0000", sort_order: 0 },
      { name: "Kids", is_default: false, counts_toward_total: true, price_multiplier: "0.5000", sort_order: 1 },
      { name: "Vendors", is_default: false, counts_toward_total: false, price_multiplier: "0.5000", sort_order: 2 },
    ];
    const p = buildEventSavePayload(
      { ...base, guest_count: 150, segment_counts: { Kids: 12, Vendors: 8 } }, meta,
    );
    expect(p.guest_counts).toEqual([
      { segment: "Kids", count: 12 },
      { segment: "Adults", count: 138 }, // derived remainder
      { segment: "Vendors", count: 8 },  // additional cover
    ]);
  });

  it("blank optional times/dates/counts become null", () => {
    const p = buildEventSavePayload(base);
    expect(p.booking_date).toBeNull();
    expect(p.guest_arrival_time).toBeNull();
  });

  it("never writes the finals numbers — only the finals endpoint may (REL-419)", () => {
    // Echoing a hydrated copy back on an ordinary save let a stale event form blank
    // a guarantee someone had just recorded, and bypassed the sum check entirely.
    const p = buildEventSavePayload(base) as Record<string, unknown>;
    expect(p).not.toHaveProperty("final_count");
    expect(p).not.toHaveProperty("final_count_due");
    expect(p).not.toHaveProperty("guaranteed_count");
  });

  it("only sends the business when B2B", () => {
    expect(buildEventSavePayload(base).account).toBeNull();      // is_b2b false → account dropped
    expect(buildEventSavePayload({ ...base, is_b2b: true }).account).toBe(9);
  });

  it("serializes meals with dish_ids (not the read-only dishes) — shared with quotes", () => {
    const p = buildEventSavePayload(base);
    expect(p.additional_meals).toEqual([
      { label: "Tea", audience: "custom", audience_segment: null, guest_count: 40, price_per_head: "15.00", dish_ids: [3], based_on_template: null, meal_time: null, notes: "" },
    ]);
  });

  it("serializes line items without per-line taxability; preserves id", () => {
    const p = buildEventSavePayload(base);
    expect(p.line_items[0]).toMatchObject({ id: 7, category: "rental", description: "Chairs" });
    expect(p.line_items[0]).not.toHaveProperty("is_taxable");
  });
});
