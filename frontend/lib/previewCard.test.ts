import { previewCardProps, storedCardProps } from "./previewCard";
import type { PricingPreview } from "./api";

const preview = (over: Partial<PricingPreview> = {}): PricingPreview => ({
  food: {
    menu_food: "4000.00",
    food_rows: [
      { name: "Adults", count: 80, rate: "45.00", amount: "3600.00" },
      { name: "Kids", count: 20, rate: "20.00", amount: "400.00" },
    ],
    meal_rows: [{ label: "Canapés", count: 100, rate: "10.00", amount: "1000.00" }],
    meals_food: "1000.00",
    food_total: "5000.00",
  },
  lines: {
    items: [{ description: "Delivery", category: "fee", unit: "flat", line_total: "500.00" }],
    add_ons_subtotal: "500.00",
  },
  totals: {
    subtotal: "5500.00", charge_base: "5500.00", service_charge: "1100.00",
    pre_tax_total: "6600.00", tax_base: "6600.00", tax_amount: "561.00",
    gratuity: "275.00", total: "7436.00",
  },
  rates: { tax_rate: "0.0850", service_charge_pct: "20", service_charge_taxable: true, gratuity_pct: "5" },
  ...over,
} as PricingPreview);

describe("previewCardProps — the engine's answer, laid out", () => {
  it("passes every money value through as the STRING the engine sent", () => {
    const props = previewCardProps(preview(), "$");
    // Not 5500, not "5,500.00" — the exact characters the backend produced. Parsing
    // and re-formatting is the drift this whole epic removes.
    expect(props.subtotal).toBe("5500.00");
    expect(props.total).toBe("7436.00");
    expect(props.taxAmount).toBe("561.00");
    expect(props.serviceCharge).toBe("1100.00");
    expect(props.gratuity).toBe("275.00");
    expect(props.addOnsTotal).toBe("500.00");
  });

  it("shows the MENU food, not the food total, so meals aren't counted twice", () => {
    // `food_total` includes the meals, which are rendered as their own rows below.
    const props = previewCardProps(preview(), "$");
    expect(props.foodTotal).toBe("4000.00");
  });

  it("keeps the itemized segment rows as sent", () => {
    const props = previewCardProps(preview(), "$");
    expect(props.foodRows).toEqual([
      { name: "Adults", count: 80, rate: "45.00", amount: "3600.00" },
      { name: "Kids", count: 20, rate: "20.00", amount: "400.00" },
    ]);
  });

  it("keeps a null food_rows null, so the single food line still renders", () => {
    // `[]` would read as "there are no food rows" and hide the food line entirely.
    const p = preview();
    const props = previewCardProps({ ...p, food: { ...p.food, food_rows: null } }, "$");
    expect(props.foodRows).toBeNull();
  });

  it("labels each meal row with its rate and head count", () => {
    const props = previewCardProps(preview(), "$");
    expect(props.meals).toEqual([{ label: "Canapés ($10.00/head × 100)", total: "1000.00" }]);
  });

  it("has no meal rows when the booking has no meals", () => {
    const p = preview();
    const props = previewCardProps({ ...p, food: { ...p.food, meal_rows: [] } }, "$");
    expect(props.meals).toEqual([]);
  });
});

describe("storedCardProps — what was saved, not what would be", () => {
  const saved = {
    food_total: "5000.00", subtotal: "5500.00", service_charge: "1100.00",
    tax_amount: "561.00", gratuity: "275.00", total: "7436.00",
  };

  it("renders the booking's own snapshot when it has one", () => {
    const props = storedCardProps({ ...saved, pricing_snapshot: preview() }, "$");
    // The full breakdown, itemized rows and all — the engine's answer at save time.
    expect(props.foodRows).toHaveLength(2);
    expect(props.meals).toHaveLength(1);
    expect(props.total).toBe("7436.00");
    expect(props.addOnsTotal).toBe("500.00");
  });

  it("falls back to the flat columns for a booking saved before snapshots", () => {
    const props = storedCardProps({ ...saved, pricing_snapshot: null }, "$");
    expect(props.total).toBe("7436.00");
    expect(props.subtotal).toBe("5500.00");
    expect(props.foodTotal).toBe("5000.00");
    // Nothing to itemize — the columns don't record the breakdown.
    expect(props.foodRows).toBeNull();
    expect(props.meals).toEqual([]);
    // The add-ons line is recovered by subtraction, the one thing the columns can
    // still tell us.
    expect(props.addOnsTotal).toBe("500");
  });

  it("treats a missing snapshot key the same as a null one", () => {
    const props = storedCardProps(saved, "$");
    expect(props.total).toBe("7436.00");
    expect(props.foodRows).toBeNull();
  });

  it("shows no service charge or gratuity when the legacy row carried none", () => {
    const props = storedCardProps(
      { food_total: "1000.00", subtotal: "1000.00", tax_amount: "0.00", total: "1000.00" },
      "$",
    );
    expect(props.serviceCharge).toBe("0");
    expect(props.gratuity).toBe("0");
    expect(props.addOnsTotal).toBe("0");
  });
});
