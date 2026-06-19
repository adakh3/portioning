import { describe, it, expect } from "vitest";
import { computeQuoteTotals, buildQuoteSavePayload, lineItemTotal, LineItemInput } from "./quoteTotals";

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

describe("buildQuoteSavePayload", () => {
  const editData = {
    primary_contact: "3", event_date: "2026-09-01", guest_count: "100",
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
});
