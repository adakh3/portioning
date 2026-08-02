import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, within } from "@testing-library/react";

import GuestCountField, { GuestCountValue } from "./GuestCountField";
import { GuestSegmentMeta } from "@/lib/quoteTotals";

// REL-428 — the breakdown reads as one unit per segment, with an owned rate.
// A separate file from GuestCountField.test.tsx on purpose: AC6 says the existing
// tests pass unmodified, and keeping them byte-identical makes that claim literal.
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

function setup(over: Partial<GuestCountValue> = {}, segments: GuestSegmentMeta[] = US, pricePerHead = "10") {
  mockUseSiteSettings.mockReturnValue({ data: { guest_segments: segments } });
  const onChange = vi.fn();
  render(<GuestCountField value={{ ...base, ...over }} onChange={onChange} pricePerHead={pricePerHead} />);
  return onChange;
}

/** The bounded cell for a segment: the element that owns its name label. */
function cellFor(name: string) {
  const label = screen.getByText(name, { selector: "label" });
  const cell = label.parentElement;
  if (!cell) throw new Error(`no cell for ${name}`);
  return cell;
}

describe("GuestCountField — the breakdown says who is priced at what (REL-428)", () => {
  it("AC1: a segment's name, count and rate live in ONE cell, and the rate names the segment", () => {
    setup({ guest_count: 150, segment_counts: { Kids: 12 } });

    const kids = cellFor("Kids");
    // The count and the rate belong to the same visual unit as the name — this is
    // the assertion that fails if the rate ever floats free of its segment again.
    expect(within(kids).getByLabelText("Kids")).toBeInTheDocument();
    expect(within(kids).getByLabelText("Kids price per head")).toBeInTheDocument();
    // ...and it is labelled "Kids $/head", not a bare "$/head".
    expect(within(kids).getByText("Kids $/head")).toBeInTheDocument();
    expect(screen.queryByText("$/head")).not.toBeInTheDocument();
  });

  it("AC2: the editable segment and the derived one have the same shape — both carry a rate", () => {
    setup({ guest_count: 150, segment_counts: { Kids: 12 } });

    for (const name of ["Kids", "Adults"]) {
      const cell = cellFor(name);
      expect(within(cell).getByText(`${name} $/head`)).toBeInTheDocument();
      expect(within(cell).getByLabelText(`${name} price per head`)).toBeInTheDocument();
    }
  });

  // jsdom has no layout engine, so "the columns line up" can't be measured here —
  // only the class contract that produces it. These three assertions are what would
  // have caught the derived count box being 4px taller than every editable input,
  // which is exactly the ragged grid this ticket was raised about.
  it("AC2: the derived count box is the same height as an editable count input", () => {
    setup({ guest_count: 150, segment_counts: { Kids: 12 } });

    // Input's own default is h-9 (components/ui/input.tsx) — the read-only box must match.
    expect(screen.getByLabelText("Kids")).toHaveClass("h-9");
    expect(screen.getByLabelText("Adults (derived)")).toHaveClass("h-9");
  });

  it("AC2: the read-only rate box is the same height as an editable rate input", () => {
    setup({ guest_count: 150, segment_counts: { Kids: 12 } }, US, "40");

    expect(screen.getByLabelText("Kids price per head")).toHaveClass("h-8");
    expect(screen.getByLabelText("Adults price per head")).toHaveClass("h-8");
  });

  it("AC2: a validation message in one cell can't shove its rate off the shared baseline", () => {
    // Kids over the guest count → ValidatedInput renders its message INSIDE the
    // cell. The rate is pinned to the bottom of a stretched grid cell, so both
    // rates stay on one line instead of Kids' dropping below Adults'.
    setup({ guest_count: 150, segment_counts: { Kids: 200 } });

    for (const name of ["Kids", "Adults"]) {
      const rateBlock = within(cellFor(name)).getByText(`${name} $/head`).parentElement;
      expect(rateBlock).toHaveClass("mt-auto");
    }
  });

  it("AC3: the derived segment shows the booking's per-head rate, read-only", () => {
    setup({ guest_count: 150, segment_counts: { Kids: 12 } }, US, "40");

    const adultsRate = screen.getByLabelText("Adults price per head");
    expect(adultsRate).toHaveTextContent("40.00"); // the booking's price per head
    expect(adultsRate).toHaveTextContent("auto");
    // Read-only by construction: it is not an input at all, so it can't be typed in.
    expect(adultsRate.tagName).not.toBe("INPUT");
  });

  it("AC3: with no price per head yet, the derived rate shows a dash — never '0.00'", () => {
    // The Guests card sits ABOVE Menu & Pricing, so on every new booking the
    // breakdown is filled in before a price exists. "0.00 (auto)" would state as
    // fact that the guests are priced at nothing.
    for (const noPrice of ["", undefined as unknown as string]) {
      const { unmount } = render(
        <GuestCountField
          value={{ ...base, guest_count: 150, segment_counts: { Kids: 12 } }}
          onChange={vi.fn()}
          pricePerHead={noPrice}
        />,
      );
      const adultsRate = screen.getByLabelText("Adults price per head");
      expect(adultsRate).toHaveTextContent("—");
      expect(adultsRate).not.toHaveTextContent("0.00");
      unmount();
    }
  });

  it("AC3: the derived rate follows the booking's price per head, not a hardcoded one", () => {
    setup({ guest_count: 100, segment_counts: { Kids: 10 } }, US, "72.50");
    expect(screen.getByLabelText("Adults price per head")).toHaveTextContent("72.50");
  });

  it("AC4: the derived count still reads as an auto remainder, not a field", () => {
    setup({ guest_count: 150, segment_counts: { Kids: 12 } });

    const derived = screen.getByLabelText("Adults (derived)");
    expect(derived).toHaveTextContent("138");
    expect(derived).toHaveTextContent("auto");
    expect(derived.tagName).not.toBe("INPUT");
  });

  it("AC5: an editable rate still shows the multiplier default and still reports an override", () => {
    const onChange = setup({ guest_count: 150, segment_counts: { Kids: 12 } }, US, "10");

    const kidsRate = screen.getByLabelText("Kids price per head") as HTMLInputElement;
    expect(kidsRate.placeholder).toBe("5.00"); // 0.5 × $10, unchanged behaviour
    fireEvent.change(kidsRate, { target: { value: "18" } });
    expect(onChange).toHaveBeenCalledWith({ segment_prices: { Kids: "18" } });
  });

  it("AC5: an existing override renders in the box rather than the placeholder", () => {
    setup({ guest_count: 150, segment_counts: { Kids: 12 }, segment_prices: { Kids: "18" } });
    expect((screen.getByLabelText("Kids price per head") as HTMLInputElement).value).toBe("18");
  });

  it("AC7: additional covers get the identical cell — name, count and an owned rate", () => {
    setup({ guest_count: 150, segment_counts: { Kids: 12, Vendors: 8 } });

    const vendors = cellFor("Vendors");
    expect(within(vendors).getByLabelText("Vendors")).toBeInTheDocument();
    expect(within(vendors).getByLabelText("Vendors price per head")).toBeInTheDocument();
    expect(within(vendors).getByText("Vendors $/head")).toBeInTheDocument();
  });

  it("AC7: a gents/ladies org gets the same layout from its own segment data", () => {
    setup({ guest_count: 100, segment_counts: { Ladies: 40 } }, GL, "30");

    expect(within(cellFor("Ladies")).getByText("Ladies $/head")).toBeInTheDocument();
    const gents = cellFor("Gents");
    expect(within(gents).getByText("Gents $/head")).toBeInTheDocument();
    expect(within(gents).getByLabelText("Gents price per head")).toHaveTextContent("30.00");
    expect(within(gents).getByLabelText("Gents (derived)")).toHaveTextContent("60");
  });
});
