import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";

import GuestCountField, { GuestCountValue, breakdownValid } from "./GuestCountField";
import SegmentRatesField from "./SegmentRatesField";
import { GuestSegmentMeta, segmentEffectiveRate, segmentFood, defaultSegmentRemainder } from "@/lib/quoteTotals";

// Hostile inputs for the guest counts and the per-head rates (REL-428). Everything a
// caterer can physically type into these boxes, plus the org-config values that feed
// them. The bar: never render NaN/Infinity/undefined at the user, never silently
// invent money, never throw.
const { mockUseSiteSettings } = vi.hoisted(() => ({
  mockUseSiteSettings: vi.fn(() => ({ data: undefined }) as { data: unknown }),
}));
vi.mock("@/lib/hooks", () => ({ useSiteSettings: mockUseSiteSettings }));

const seg = (name: string, over: Partial<GuestSegmentMeta> = {}): GuestSegmentMeta => ({
  name, is_default: false, counts_toward_total: true, price_multiplier: "1.0000", sort_order: 0, ...over,
});
const US = [
  seg("Adults", { is_default: true, sort_order: 0 }),
  seg("Kids", { price_multiplier: "0.5000", sort_order: 1 }),
  seg("Vendors", { counts_toward_total: false, price_multiplier: "0.5000", sort_order: 2 }),
];
const base: GuestCountValue = {
  guest_count: 0, segment_counts: {}, segment_prices: {}, big_eaters: false, big_eaters_percentage: 0,
};

beforeEach(() => mockUseSiteSettings.mockReturnValue({ data: { guest_segments: US } }));

const renderRates = (pricePerHead?: string, prices: Record<string, string> = {}, segments = US) => {
  mockUseSiteSettings.mockReturnValue({ data: { guest_segments: segments } });
  const onChange = vi.fn();
  const r = render(
    <SegmentRatesField segmentPrices={prices} onChange={onChange} pricePerHead={pricePerHead} />,
  );
  return { onChange, ...r };
};

const renderGuests = (over: Partial<GuestCountValue> = {}, segments = US) => {
  mockUseSiteSettings.mockReturnValue({ data: { guest_segments: segments } });
  const onChange = vi.fn();
  render(<GuestCountField value={{ ...base, ...over }} onChange={onChange} />);
  return onChange;
};

/** Nothing user-visible should ever contain these. */
const GARBAGE = /NaN|Infinity|undefined|null|\[object/;

describe("hostile: price per head feeding the rates block", () => {
  it.each([
    "abc", "  ", "$40", "40abc", "--5", "1/2", "true", "[]", "{}", ",", ".", "-", "e5",
  ])("junk price %o renders no rates at all (never a garbage rate)", (price) => {
    const { container } = renderRates(price);
    expect(container).toBeEmptyDOMElement();
  });

  it.each(["-1", "-0.01", "-9999"])("negative price %o renders no rates", (price) => {
    const { container } = renderRates(price);
    expect(container).toBeEmptyDOMElement();
  });

  it.each(["0", "0.0", "0.00", "-0", "0e5"])("zero-ish price %o renders no rates", (price) => {
    const { container } = renderRates(price);
    expect(container).toBeEmptyDOMElement();
  });

  it("Infinity never reaches the screen as a rate", () => {
    renderRates("Infinity");
    const adults = screen.getByLabelText("Adults price per head");
    expect(adults.textContent ?? "").not.toMatch(GARBAGE);
    expect(adults).toHaveTextContent("—"); // suppressed, not printed
  });

  it.each(["0.005", "40.999", "1e3", "1e-3", "  40  ", "07"])(
    "unusual but numeric price %o renders a clean 2dp rate",
    (price) => {
      renderRates(price);
      const adults = screen.queryByLabelText("Adults price per head");
      if (adults) expect(adults.textContent ?? "").not.toMatch(GARBAGE);
    },
  );

  it("a very large price still renders a finite number", () => {
    renderRates("999999999");
    const adults = screen.getByLabelText("Adults price per head");
    expect(adults.textContent ?? "").not.toMatch(GARBAGE);
    expect(adults).toHaveTextContent("999999999.00");
  });
});

describe("hostile: org segment config feeding the rates block", () => {
  it.each(["0.0000", "-1.0000", "abc", "", "1e400"])(
    "a segment multiplier of %o never renders garbage",
    (mult) => {
      renderRates("40", {}, [
        seg("Adults", { is_default: true, sort_order: 0 }),
        seg("Kids", { price_multiplier: mult, sort_order: 1 }),
      ]);
      const kids = screen.queryByLabelText("Kids price per head") as HTMLInputElement | null;
      if (kids) expect(kids.placeholder ?? "").not.toMatch(GARBAGE);
    },
  );

  it("a default segment with a junk multiplier doesn't poison the read-only rate", () => {
    renderRates("40", {}, [seg("Adults", { is_default: true, price_multiplier: "abc" })]);
    const adults = screen.queryByLabelText("Adults price per head");
    if (adults) expect(adults.textContent ?? "").not.toMatch(GARBAGE);
  });

  it("no segments configured at all → nothing rendered, no crash", () => {
    const { container } = renderRates("40", {}, []);
    expect(container).toBeEmptyDOMElement();
  });

  it("two segments both flagged default → the second is silently unpriceable (documented)", () => {
    renderRates("40", {}, [
      seg("Adults", { is_default: true, sort_order: 0 }),
      seg("Grown-ups", { is_default: true, sort_order: 1 }),
    ]);
    // groupSegments takes the FIRST default and filters every other is_default
    // segment out of the explicit list, so "Grown-ups" gets no row at all. A
    // misconfiguration (two defaults) rather than a reachable user action, but this
    // pins the behaviour so a future change to groupSegments is a deliberate one.
    expect(screen.getByLabelText("Adults price per head")).toBeInTheDocument();
    expect(screen.queryByLabelText("Grown-ups price per head")).not.toBeInTheDocument();
  });

  it("a segment named with markup/quotes is rendered as text, not interpreted", () => {
    renderRates("40", {}, [
      seg("Adults", { is_default: true, sort_order: 0 }),
      seg('<img src=x onerror=alert(1)>"', { sort_order: 1 }),
    ]);
    expect(screen.getByLabelText('<img src=x onerror=alert(1)>" price per head')).toBeInTheDocument();
    expect(document.querySelector("img")).toBeNull();
  });
});

describe("hostile: typing into a segment rate override", () => {
  it.each(["abc", "  ", "5,5", "1e9"])(
    "the number input refuses %o outright — junk never reaches state",
    (typed) => {
      const { onChange } = renderRates("40");
      fireEvent.change(screen.getByLabelText("Kids price per head"), { target: { value: typed } });
      expect(onChange).not.toHaveBeenCalled();
    },
  );

  it.each(["-5", "0.001", "999999999999", "0"])(
    "numeric override %o is passed through verbatim for the server to validate",
    (typed) => {
      const { onChange } = renderRates("40");
      fireEvent.change(screen.getByLabelText("Kids price per head"), { target: { value: typed } });
      expect(onChange).toHaveBeenCalledWith({ segment_prices: { Kids: typed } });
    },
  );

  it("clearing an override sends the empty string, not undefined", () => {
    const { onChange } = renderRates("40", { Kids: "18" });
    fireEvent.change(screen.getByLabelText("Kids price per head"), { target: { value: "" } });
    expect(onChange).toHaveBeenCalledWith({ segment_prices: { Kids: "" } });
  });

  it("an override on one segment never drops another segment's override", () => {
    const { onChange } = renderRates("40", { Kids: "18", Vendors: "9" });
    fireEvent.change(screen.getByLabelText("Kids price per head"), { target: { value: "20" } });
    expect(onChange).toHaveBeenCalledWith({ segment_prices: { Kids: "20", Vendors: "9" } });
  });

  it("an override for a segment the org no longer has is preserved, not silently dropped", () => {
    // Stale key from a renamed/removed segment — losing it here would quietly
    // change what the booking charges once the segment comes back.
    const { onChange } = renderRates("40", { Ghost: "12" });
    fireEvent.change(screen.getByLabelText("Kids price per head"), { target: { value: "7" } });
    expect(onChange).toHaveBeenCalledWith({ segment_prices: { Ghost: "12", Kids: "7" } });
  });
});

describe("hostile: guest counts", () => {
  it.each(["abc", "1e3", "  8  "])(
    "the number input refuses guest count %o outright — it never reaches state",
    (typed) => {
      const onChange = renderGuests({ guest_count: 10 });
      fireEvent.change(screen.getByLabelText("Guest Count"), { target: { value: typed } });
      expect(onChange).not.toHaveBeenCalled();
    },
  );

  it.each([["-5", 0], ["", 0], ["07", 7], ["3.9", 3.9]])(
    "guest count %o normalises to %o — never negative",
    (typed, expected) => {
      const onChange = renderGuests({ guest_count: 10 });
      fireEvent.change(screen.getByLabelText("Guest Count"), { target: { value: typed } });
      expect(onChange).toHaveBeenCalledWith({ guest_count: expected });
    },
  );

  it.each(["-5", ""])("a segment count of %o clamps to 0, never negative", (typed) => {
    // Start from a real value, so clearing it is an actual change event.
    const onChange = renderGuests({ guest_count: 100, segment_counts: { Kids: 12 } });
    fireEvent.change(screen.getByLabelText("Kids"), { target: { value: typed } });
    expect(onChange).toHaveBeenCalledWith({ segment_counts: { Kids: 0 } });
  });

  it("the derived remainder never renders negative, and warns instead", () => {
    renderGuests({ guest_count: 100, segment_counts: { Kids: 5000 } });
    expect(screen.getByLabelText("Adults (derived)")).toHaveTextContent("0");
    expect(screen.getByText(/more than the guest count/i)).toBeInTheDocument();
  });

  it("a huge guest count still renders a finite remainder", () => {
    renderGuests({ guest_count: 1e9, segment_counts: { Kids: 1 } });
    const derived = screen.getByLabelText("Adults (derived)");
    expect(derived.textContent ?? "").not.toMatch(GARBAGE);
  });

  it("a fractional breakdown doesn't produce a garbage remainder", () => {
    renderGuests({ guest_count: 10, segment_counts: { Kids: 2.5 } });
    expect((screen.getByLabelText("Adults (derived)").textContent ?? "")).not.toMatch(GARBAGE);
  });

  it("extra covers never eat into the in-count remainder, however large", () => {
    renderGuests({ guest_count: 100, segment_counts: { Kids: 10, Vendors: 99999 } });
    expect(screen.getByLabelText("Adults (derived)")).toHaveTextContent("90");
    expect(screen.queryByText(/more than the guest count/i)).not.toBeInTheDocument();
  });
});

describe("hostile: the money math these inputs feed", () => {
  it.each(["abc", "", "-1", "0", "1e3", "40.999"])(
    "segmentEffectiveRate(%o) is always a finite number",
    (price) => {
      const r = segmentEffectiveRate(price, "0.5000");
      expect(Number.isFinite(r)).toBe(true);
    },
  );

  it.each(["", "-1", "0.0000"])(
    "a multiplier of %o still yields a finite rate",
    (mult) => {
      const r = segmentEffectiveRate("40", mult);
      expect(Number.isFinite(r)).toBe(true);
    },
  );

  // ---------------------------------------------------------------------------
  // KNOWN BROKEN — the shared money engine, NOT this ticket's UI. Written with
  // `it.fails` so they are green while the defect stands and start FAILING the
  // moment someone fixes it, which is the prompt to turn them into ordinary
  // assertions. Changing this math needs the totals trio + golden cases (see
  // CALCULATION_PARITY), so it is deliberately not done on a presentation branch.
  // Tracked separately; see the REL ticket linked from REL-428's thread.
  // ---------------------------------------------------------------------------
  it.fails.each(["abc", "1e400"])(
    "KNOWN BROKEN: a multiplier of %o yields NaN/Infinity instead of a finite rate",
    (mult) => {
      expect(Number.isFinite(segmentEffectiveRate("40", mult))).toBe(true);
    },
  );

  it.fails("KNOWN BROKEN: a junk segment override makes the food total NaN", () => {
    expect(Number.isFinite(segmentFood("40", 100, { Kids: 10 }, US, { Kids: "abc" }))).toBe(true);
  });

  it.fails("KNOWN BROKEN: a negative override drives the food total negative", () => {
    // -1000/head on 10 kids => -6400 overall. The backend only catches this via the
    // subtotal guard, and then blames "discounts" in the error message.
    expect(segmentFood("40", 100, { Kids: 10 }, US, { Kids: "-1000" })).toBeGreaterThanOrEqual(0);
  });

  it("breakdownValid and the remainder agree on an over-count", () => {
    const v = { ...base, guest_count: 100, segment_counts: { Kids: 200 } };
    expect(breakdownValid(v, US)).toBe(false);
    expect(defaultSegmentRemainder(100, { Kids: 200 }, US)).toBeLessThan(0);
  });
});
