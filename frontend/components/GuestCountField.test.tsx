import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";

import GuestCountField, { GuestCountValue, breakdownValid } from "./GuestCountField";
import { GuestSegmentMeta } from "@/lib/quoteTotals";

const { mockUseSiteSettings } = vi.hoisted(() => ({
  mockUseSiteSettings: vi.fn(() => ({ data: undefined }) as { data: unknown }),
}));
vi.mock("@/lib/hooks", () => ({ useSiteSettings: mockUseSiteSettings }));

const seg = (name: string, over: Partial<GuestSegmentMeta> = {}): GuestSegmentMeta => ({
  name, is_default: false, counts_toward_total: true, price_multiplier: "1.0000", sort_order: 0, ...over,
});

// A US Adults(default)/Kids/Vendors org and a gents/ladies org — same UI, from data only.
const US = [
  seg("Adults", { is_default: true, sort_order: 0 }),
  seg("Kids", { price_multiplier: "0.5000", sort_order: 1 }),
  seg("Vendors", { counts_toward_total: false, price_multiplier: "0.5000", sort_order: 2 }),
];
const GL = [seg("Gents", { is_default: true, sort_order: 0 }), seg("Ladies", { sort_order: 1 })];

const base: GuestCountValue = { guest_count: 0, segment_counts: {}, segment_prices: {}, big_eaters: false, big_eaters_percentage: 0 };

const val = (el: HTMLElement) => (el as HTMLInputElement).value;

beforeEach(() => mockUseSiteSettings.mockReturnValue({ data: { guest_segments: US } }));

function setup(over: Partial<GuestCountValue> = {}, segments: GuestSegmentMeta[] = US) {
  mockUseSiteSettings.mockReturnValue({ data: { guest_segments: segments } });
  const onChange = vi.fn();
  render(<GuestCountField value={{ ...base, ...over }} onChange={onChange} />);
  return onChange;
}

describe("GuestCountField — count-first breakdown", () => {
  it("editing the guest count reports just that (never fabricates a breakdown)", () => {
    const onChange = setup({ guest_count: 0 });
    fireEvent.change(screen.getByLabelText("Guest Count"), { target: { value: "41" } });
    expect(onChange).toHaveBeenCalledWith({ guest_count: 41 });
  });

  it("AC1: entering Kids reports it as an explicit segment count", () => {
    const onChange = setup({ guest_count: 150 });
    fireEvent.change(screen.getByLabelText("Kids"), { target: { value: "12" } });
    expect(onChange).toHaveBeenCalledWith({ segment_counts: { Kids: 12 } });
    // (The derived Adults = 138 read-only field is asserted in AC4.)
  });

  it("AC2: no breakdown → the whole count is the default segment", () => {
    setup({ guest_count: 150 });
    expect(val(screen.getByLabelText("Guest Count"))).toBe("150");
    expect(screen.getByLabelText("Adults (derived)")).toHaveTextContent("150");
    expect(val(screen.getByLabelText("Kids"))).toBe("");
  });

  it("AC3: an over-count breakdown shows a validation warning", () => {
    setup({ guest_count: 150, segment_counts: { Kids: 200 } });
    expect(screen.getByText(/more than the guest count/i)).toBeInTheDocument();
  });

  it("AC4: vendors are additional covers — separate section, no effect on the remainder", () => {
    setup({ guest_count: 150, segment_counts: { Kids: 12, Vendors: 8 } });
    expect(screen.getByLabelText("Adults (derived)")).toHaveTextContent("138"); // not 130
    expect(screen.getByText(/Additional covers/i)).toBeInTheDocument();
    expect(screen.getByText(/Add it as a separate meal instead/i)).toBeInTheDocument();
    expect(val(screen.getByLabelText("Vendors"))).toBe("8");
  });

  it("AC5: a gents/ladies org gets the SAME remainder UI (Ladies input + Gents derived), no checkbox", () => {
    setup({ guest_count: 100, segment_counts: { Ladies: 40 } }, GL);
    expect(val(screen.getByLabelText("Ladies"))).toBe("40");
    expect(screen.getByLabelText("Gents (derived)")).toHaveTextContent("60");
    expect(screen.queryByRole("checkbox", { name: /split/i })).not.toBeInTheDocument();
  });

  it("per-segment rate box: shows the multiplier default as placeholder, stores an edit", () => {
    mockUseSiteSettings.mockReturnValue({ data: { guest_segments: US } });
    const onChange = vi.fn();
    render(
      <GuestCountField
        value={{ ...base, guest_count: 150, segment_counts: { Kids: 12 } }}
        onChange={onChange}
        pricePerHead="10"
      />,
    );
    const kidsRate = screen.getByLabelText("Kids price per head") as HTMLInputElement;
    expect(kidsRate.placeholder).toBe("5.00"); // 0.5 × $10 default
    fireEvent.change(kidsRate, { target: { value: "18" } });
    expect(onChange).toHaveBeenCalledWith({ segment_prices: { Kids: "18" } });
  });

  it("enables the big-eaters modifier", () => {
    const onChange = setup({ guest_count: 50 });
    fireEvent.click(screen.getByRole("checkbox", { name: /hearty eaters/i }));
    expect(onChange).toHaveBeenCalledWith({ big_eaters: true });
  });
});

describe("breakdownValid", () => {
  it("true when the remainder is ≥ 0, false when the in-count breakdown exceeds the count", () => {
    expect(breakdownValid({ ...base, guest_count: 150, segment_counts: { Kids: 12 } }, US)).toBe(true);
    expect(breakdownValid({ ...base, guest_count: 150, segment_counts: { Kids: 200 } }, US)).toBe(false);
    // Vendors (additional covers) never count against the guest count.
    expect(breakdownValid({ ...base, guest_count: 150, segment_counts: { Kids: 150, Vendors: 99 } }, US)).toBe(true);
  });
});
