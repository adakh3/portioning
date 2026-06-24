import { describe, it, expect } from "vitest";
import { computeQuoteTotals, computeBookingTotals, buildQuoteSavePayload, lineItemTotal, LineItemInput } from "./quoteTotals";

const item = (over: Partial<LineItemInput>): LineItemInput => ({
  category: "rental",
  description: "x",
  quantity: 1,
  unit: "each",
  unit_price: 0,
  is_taxable: true,
  ...over,
});

describe("computeQuoteTotals", () => {
  it("food only (price × guests) goes into subtotal", () => {
    expect(computeQuoteTotals(50, 100, 0, [])).toEqual({
      food_total: 5000, subtotal: 5000, tax_amount: 0, total: 5000,
    });
  });

  it("applies tax to the taxable subtotal (food is taxable)", () => {
    expect(computeQuoteTotals(50, 100, 0.2, [])).toEqual({
      food_total: 5000, subtotal: 5000, tax_amount: 1000, total: 6000,
    });
  });

  it("line items only, no per-head price", () => {
    const t = computeQuoteTotals(0, 100, 0, [
      item({ unit: "each", quantity: 10, unit_price: 5, is_taxable: true }),
    ]);
    expect(t).toEqual({ food_total: 0, subtotal: 50, tax_amount: 0, total: 50 });
  });

  it("splits taxable vs non-taxable, taxes only taxable", () => {
    const t = computeQuoteTotals(0, 50, 0.1, [
      item({ unit: "flat", quantity: 1, unit_price: 200, is_taxable: true }),
      item({ unit: "flat", quantity: 1, unit_price: 100, is_taxable: false }),
    ]);
    // subtotal 300; tax = 10% of taxable 200 = 20; total 320
    expect(t).toEqual({ food_total: 0, subtotal: 300, tax_amount: 20, total: 320 });
  });

  it("per_guest unit multiplies by guest count", () => {
    expect(lineItemTotal(item({ unit: "per_guest", unit_price: 12.5 }), 50)).toBe(625);
  });

  it("discount line is negative", () => {
    expect(
      lineItemTotal(item({ category: "discount", unit: "flat", quantity: 1, unit_price: 100 }), 10),
    ).toBe(-100);
  });

  it("zero/blank price yields no food cost", () => {
    expect(computeQuoteTotals("", 100, 0.2, []).food_total).toBe(0);
  });
});

describe("computeBookingTotals (shared engine — quotes & events)", () => {
  it("foodTotal already includes meals; tax on food + taxable items only", () => {
    // event-style: food 1000 + meals 300 = 1300 foodTotal, +200 taxable, +100 non-taxable
    const t = computeBookingTotals(1300, [
      item({ unit: "flat", quantity: 1, unit_price: 200, is_taxable: true }),
      item({ unit: "flat", quantity: 1, unit_price: 100, is_taxable: false }),
    ], 50, 0.15);
    // taxable = 1300 + 200 = 1500; subtotal = 1600; tax = 1500*0.15 = 225
    expect(t).toEqual({ food_total: 1300, subtotal: 1600, tax_amount: 225, total: 1825 });
  });

  it("passing rate 0 (not taxable) yields no tax", () => {
    const t = computeBookingTotals(1000, [item({ unit: "flat", unit_price: 100 })], 20, 0);
    expect(t).toEqual({ food_total: 1000, subtotal: 1100, tax_amount: 0, total: 1100 });
  });

  it("matches computeQuoteTotals for the same inputs (no meals)", () => {
    const items = [item({ unit: "each", quantity: 10, unit_price: 5, is_taxable: true })];
    expect(computeBookingTotals(50 * 100, items, 100, 0.2)).toEqual(
      computeQuoteTotals(50, 100, 0.2, items),
    );
  });
});

describe("buildQuoteSavePayload", () => {
  const editData = {
    primary_contact: "3", is_b2b: false, account: "", event_date: "2026-09-01", guest_count: "100",
    price_per_head: "50.00", venue: "", venue_address: "", event_type: "wedding",
    meal_type: "", booking_date: "", service_style: "", tax_rate: "20",
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
