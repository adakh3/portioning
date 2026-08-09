import { taxRateFraction, taxRatePercent, pricingDraft, buildQuoteSavePayload, type QuoteEditData } from "./bookingPayload";

// The percent/fraction seam. Four hand-written copies of this conversion used to be
// spread across two pages, and they disagreed: the create form held a FRACTION in
// state while displaying percent, the edit form held a PERCENT. A quote hydrated at
// 8.5% could save at 850%, or at 0.085%, depending which screen you were on.
describe("tax rate — one convention, converted in one place", () => {
  it("form percent becomes the stored fraction", () => {
    expect(taxRateFraction("8.5")).toBe("0.08500");
    expect(taxRateFraction("20")).toBe("0.20000");
    expect(taxRateFraction("0")).toBe("0.00000");
    // The rate that four decimals could not hold — NYC.
    expect(taxRateFraction("8.875")).toBe("0.08875");
  });

  it("stored fraction becomes the form percent", () => {
    expect(taxRatePercent("0.08500")).toBe("8.5");
    expect(taxRatePercent("0.20000")).toBe("20");
    expect(taxRatePercent("0.00000")).toBe("0");
    expect(taxRatePercent("0.08875")).toBe("8.875");
    // Rows stored before the column was widened still read back correctly.
    expect(taxRatePercent("0.0850")).toBe("8.5");
  });

  it("survives a round trip at the rates US orgs actually charge", () => {
    // 8.5% is the AC9 case; the rest are real state/city rates, all with the
    // fractional cents that expose a floating-point slip.
    for (const pct of ["8.5", "8.875", "7.25", "6", "10.25", "0"]) {
      expect(taxRatePercent(taxRateFraction(pct))).toBe(pct);
    }
  });

  it("never shows binary-floating-point noise in the field", () => {
    // 0.0850 * 100 is 8.500000000000001 in JS. Nobody wants that in a tax box.
    expect(taxRatePercent("0.0850")).not.toContain("000000");
  });

  it("treats a blank or junk rate as zero rather than NaN", () => {
    for (const junk of ["", null, undefined, "abc"]) {
      expect(taxRateFraction(junk)).toBe("0.00000");
      expect(taxRatePercent(junk)).toBe("0");
    }
  });
});

describe("pricingDraft — the slice the preview endpoint reads", () => {
  // Tax is stated, never inferred: a quote save carries a rate and no gate, an
  // event save carries a gate and no rate, so neither payload can supply both.
  const TAX = { is_taxable: true, tax_rate: "0.08875" };

  const savePayload = {
    price_per_head: "50.00",
    guest_count: 100,
    guest_counts: [{ segment: "Adults", count: 100 }],
    additional_meals: [{ label: "Canapés", price_per_head: "10.00", guest_count: 100 }],
    line_items: [{ category: "fee", description: "Delivery", quantity: 1, unit: "flat", unit_price: "500" }],
    tax_rate: "0.08875",
    service_charge_pct: "20",
    service_charge_taxable: true,
    gratuity_pct: "0",
    // Not price — must not ride along, or every keystroke of a customer note
    // re-prices the booking.
    notes: "Please use the side entrance",
    internal_notes: "chase deposit",
    primary_contact: 3,
    dish_ids: [1, 2, 3],
  };

  it("carries every input the engine prices", () => {
    const draft = pricingDraft(savePayload, TAX);
    expect(draft).toEqual({
      price_per_head: "50.00",
      guest_count: 100,
      guest_counts: [{ segment: "Adults", count: 100 }],
      additional_meals: [{ label: "Canapés", price_per_head: "10.00", guest_count: 100 }],
      line_items: [{ category: "fee", description: "Delivery", quantity: 1, unit: "flat", unit_price: "500" }],
      service_charge_pct: "20",
      service_charge_taxable: true,
      gratuity_pct: "0",
      is_taxable: true,
      tax_rate: "0.08875",
    });
  });

  it("drops everything that is not price", () => {
    const draft = pricingDraft(savePayload, TAX);
    for (const key of ["notes", "internal_notes", "primary_contact", "dish_ids"]) {
      expect(draft).not.toHaveProperty(key);
    }
  });

  it("always states BOTH the gate and the rate", () => {
    // Reading tax out of whichever key the payload happened to carry priced an
    // event-shaped draft at zero tax and a non-taxable quote at full tax. Both keys,
    // every time, from the caller.
    const draft = pricingDraft(savePayload, TAX);
    expect(draft.is_taxable).toBe(true);
    expect(draft.tax_rate).toBe("0.08875");
  });

  it("states the rate even when the gate is off", () => {
    // Not an omission — "not taxed, and here is the rate we are not applying".
    // The server multiplies; it never has to guess which half is missing.
    const draft = pricingDraft(savePayload, { is_taxable: false, tax_rate: "0.08875" });
    expect(draft.is_taxable).toBe(false);
    expect(draft.tax_rate).toBe("0.08875");
  });

  it("prices an EVENT-shaped save payload, which carries no rate of its own", () => {
    // The gap this signature closes: `buildEventSavePayload` emits `is_taxable` and
    // no `tax_rate`, so a draft built from it alone previewed ZERO tax.
    const eventSave = { guest_count: 10, price_per_head: "20.00", is_taxable: true };
    const draft = pricingDraft(eventSave, { is_taxable: true, tax_rate: "0.08875" });
    expect(draft.tax_rate).toBe("0.08875");
    expect(draft.is_taxable).toBe(true);
  });

  it("is a SUBSET of the save payload, field for field (AC1)", () => {
    // The guarantee that makes "what you see is what you save" structural rather
    // than a promise: every key the preview prices came off the save body, with the
    // same value. If a builder ever spells a field differently for the two, this
    // fails.
    const draft = pricingDraft(savePayload, TAX) as Record<string, unknown>;
    for (const [key, value] of Object.entries(draft)) {
      // Tax is the one thing stated separately — neither save payload carries both
      // halves, which is exactly why it is a parameter.
      if (key === "is_taxable" || key === "tax_rate") continue;
      expect(savePayload).toHaveProperty(key);
      expect(value).toEqual((savePayload as Record<string, unknown>)[key]);
    }
  });

  it("prices a blank draft as nothing rather than undefined", () => {
    const draft = pricingDraft({}, TAX);
    expect(draft.guest_count).toBe(0);
    expect(draft.line_items).toEqual([]);
    expect(draft.additional_meals).toEqual([]);
    expect(draft.service_charge_pct).toBe("0");
  });

  it("narrows a real quote save payload without losing a priced field", () => {
    const form: QuoteEditData = {
      primary_contact: "3", is_b2b: false, account: "", event_date: "2026-09-01",
      guest_count: 80, segment_counts: {}, segment_prices: {},
      big_eaters: false, big_eaters_percentage: 0, price_per_head: "45.00",
      venue: "", venue_address: "", event_type: "wedding", meal_type: "",
      booking_date: "", service_style: "", product: "", setup_time: "",
      guest_arrival_time: "", meal_time: "", end_time: "",
      tax_rate: "8.875", service_charge_pct: "20", service_charge_taxable: true,
      gratuity_pct: "5", valid_until: "", notes: "", internal_notes: "",
    };
    const save = buildQuoteSavePayload(form, { dish_ids: [], based_on_template: null }, []);
    const draft = pricingDraft(save, TAX);
    // The converted fraction, not the form's percent — the preview and the save are
    // handed the same spelling because they are handed the same object.
    expect(draft.tax_rate).toBe("0.08875");
    expect(draft.price_per_head).toBe("45.00");
    expect(draft.guest_count).toBe(80);
    expect(draft.gratuity_pct).toBe("5");
  });
});
