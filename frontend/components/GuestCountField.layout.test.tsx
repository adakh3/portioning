import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, within } from "@testing-library/react";

import GuestCountField, { GuestCountValue } from "./GuestCountField";
import { GuestSegmentMeta } from "@/lib/quoteTotals";

// REL-428 — the Guests card is COUNTS ONLY. Each segment reads as one unit, and the
// derived segment lines up with the editable ones instead of running a control
// short. Rates moved to Menu & Pricing; see SegmentRatesField.test.tsx.
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
// A different org shape entirely — proves the layout is data-driven, not hardcoded.
const GL = [seg("Gents", { is_default: true, sort_order: 0 }), seg("Ladies", { sort_order: 1 })];

const base: GuestCountValue = {
  guest_count: 0, segment_counts: {}, segment_prices: {}, big_eaters: false, big_eaters_percentage: 0,
};

beforeEach(() => mockUseSiteSettings.mockReturnValue({ data: { guest_segments: US } }));

function setup(over: Partial<GuestCountValue> = {}, segments: GuestSegmentMeta[] = US) {
  mockUseSiteSettings.mockReturnValue({ data: { guest_segments: segments } });
  const onChange = vi.fn();
  render(<GuestCountField value={{ ...base, ...over }} onChange={onChange} />);
  return onChange;
}

/** The bounded cell for a segment: the element that owns its name label. */
function cellFor(name: string) {
  const label = screen.getByText(name, { selector: "label" });
  const cell = label.parentElement;
  if (!cell) throw new Error(`no cell for ${name}`);
  return cell;
}

describe("GuestCountField — counts read as one unit per segment (REL-428)", () => {
  it("AC1: a segment's name and count live in ONE cell", () => {
    setup({ guest_count: 150, segment_counts: { Kids: 12 } });

    expect(within(cellFor("Kids")).getByLabelText("Kids")).toBeInTheDocument();
    expect(within(cellFor("Adults")).getByLabelText("Adults (derived)")).toBeInTheDocument();
  });

  // jsdom has no layout engine, so "the columns line up" can't be measured here —
  // only the class contract that produces it. This is what would have caught the
  // derived box being 4px taller than every editable input, which is exactly the
  // ragged grid this ticket was raised about.
  it("AC2: the derived count box is the same height as an editable count input", () => {
    setup({ guest_count: 150, segment_counts: { Kids: 12 } });

    // Input's own default is h-9 (components/ui/input.tsx) — the read-only box must match.
    expect(screen.getByLabelText("Kids")).toHaveClass("h-9");
    expect(screen.getByLabelText("Adults (derived)")).toHaveClass("h-9");
  });

  it("AC4: the derived count still reads as an auto remainder, not a field", () => {
    setup({ guest_count: 150, segment_counts: { Kids: 12 } });

    const derived = screen.getByLabelText("Adults (derived)");
    expect(derived).toHaveTextContent("138");
    expect(derived).toHaveTextContent("auto");
    expect(derived.tagName).not.toBe("INPUT");
  });

  it("AC7: additional covers get the identical cell", () => {
    setup({ guest_count: 150, segment_counts: { Kids: 12, Vendors: 8 } });

    expect(within(cellFor("Vendors")).getByLabelText("Vendors")).toBeInTheDocument();
    expect(screen.getByText(/Additional covers/i)).toBeInTheDocument();
  });

  it("AC7: a gents/ladies org gets the same layout from its own segment data", () => {
    setup({ guest_count: 100, segment_counts: { Ladies: 40 } }, GL);

    expect(within(cellFor("Ladies")).getByLabelText("Ladies")).toBeInTheDocument();
    expect(within(cellFor("Gents")).getByLabelText("Gents (derived)")).toHaveTextContent("60");
  });
});
