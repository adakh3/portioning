import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";

import SegmentRatesField from "./SegmentRatesField";
import { GuestSegmentMeta } from "@/lib/quoteTotals";

// REL-428 — per-head rate by guest type, in Menu & Pricing beside the Price/head it
// derives from. Moved out of the Guests card because that card is filled in BEFORE
// the menu is priced, so every rate there was unknowable at the time.
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
const GL = [seg("Gents", { is_default: true, sort_order: 0 }), seg("Ladies", { sort_order: 1 })];

beforeEach(() => mockUseSiteSettings.mockReturnValue({ data: { guest_segments: US } }));

function setup(pricePerHead?: string, prices: Record<string, string> = {}, segments = US) {
  mockUseSiteSettings.mockReturnValue({ data: { guest_segments: segments } });
  const onChange = vi.fn();
  render(
    <SegmentRatesField segmentPrices={prices} onChange={onChange} pricePerHead={pricePerHead} />,
  );
  return onChange;
}

describe("SegmentRatesField — rates only once there is a price (REL-428)", () => {
  // The bug this component exists to kill: the Price/head auto-fill writes "0.00"
  // as soon as a menu template loads (the dishes carry no selling price), so a
  // blank-only guard put "$0.00 per head" on screen as a statement of fact.
  it.each([undefined, "", "0", "0.00"])(
    "renders NOTHING when the price per head is %o — no rate can be known yet",
    (price) => {
      const { container } = render(
        <SegmentRatesField segmentPrices={{}} onChange={vi.fn()} pricePerHead={price} />,
      );
      expect(container).toBeEmptyDOMElement();
    },
  );

  it("appears the moment a real price exists", () => {
    setup("40");
    expect(screen.getByText(/price per head by guest type/i)).toBeInTheDocument();
  });

  it("the default segment shows the base rate, read-only", () => {
    setup("40");

    const adults = screen.getByLabelText("Adults price per head");
    expect(adults).toHaveTextContent("40.00");
    expect(adults).toHaveTextContent("auto");
    expect(adults.tagName).not.toBe("INPUT"); // not overridable — a product decision
  });

  it("the default rate tracks the booking's price per head", () => {
    setup("72.50");
    expect(screen.getByLabelText("Adults price per head")).toHaveTextContent("72.50");
  });

  it("other segments show their multiplier default as a placeholder and store an override", () => {
    const onChange = setup("10");

    const kids = screen.getByLabelText("Kids price per head") as HTMLInputElement;
    expect(kids.placeholder).toBe("5.00"); // 0.5 × $10
    fireEvent.change(kids, { target: { value: "18" } });
    expect(onChange).toHaveBeenCalledWith({ segment_prices: { Kids: "18" } });
  });

  it("an existing override renders in the box rather than the placeholder", () => {
    setup("10", { Kids: "18" });
    expect((screen.getByLabelText("Kids price per head") as HTMLInputElement).value).toBe("18");
  });

  it("an override on one segment leaves the others alone", () => {
    const onChange = setup("10", { Kids: "18" });

    fireEvent.change(screen.getByLabelText("Vendors price per head"), { target: { value: "7" } });
    expect(onChange).toHaveBeenCalledWith({ segment_prices: { Kids: "18", Vendors: "7" } });
  });

  it("additional covers appear and are marked as extra covers", () => {
    setup("40");

    expect(screen.getByLabelText("Vendors price per head")).toBeInTheDocument();
    expect(screen.getByText(/extra cover/i)).toBeInTheDocument();
  });

  it("is data-driven: a gents/ladies org sees its own segments", () => {
    setup("30", {}, GL);

    expect(screen.getByLabelText("Gents price per head")).toHaveTextContent("30.00");
    expect(screen.getByLabelText("Ladies price per head")).toBeInTheDocument();
    expect(screen.queryByLabelText("Kids price per head")).not.toBeInTheDocument();
  });

  it("an org with only a default segment still gets its rate stated", () => {
    // No Kids, no Vendors — the org doesn't split its guest count. It should still
    // see what its guests cost, which is the gap the old Guests-card layout left
    // open for exactly this org shape.
    mockUseSiteSettings.mockReturnValue({
      data: { guest_segments: [seg("Adults", { is_default: true })] },
    });
    render(<SegmentRatesField segmentPrices={{}} onChange={vi.fn()} pricePerHead="40" />);

    expect(screen.getByLabelText("Adults price per head")).toHaveTextContent("40.00");
  });
});
