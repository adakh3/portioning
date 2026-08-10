import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";

// MenuBuilder pulls in SWR/data; stub it to a marker so we test this editor's own wiring.
vi.mock("@/components/MenuBuilder", () => ({
  default: ({ pricePerHead }: { pricePerHead: string }) => <div data-testid="menu-builder">menu:{pricePerHead}</div>,
}));
// NOT mocked. The first attempt kept a `formatDateTime: (s) => `fmt(${s})`` stub
// "so the real formatters run" — but formatDateTime was the function WITH the bug,
// and `fmt(2026-09-01T19:00:00Z)` contains the substring "19:00", so the new
// regression test passed against the pre-fix component in every timezone. A mock
// that stubs the thing under test cannot test it.

import AdditionalMealsEditor from "./AdditionalMealsEditor";
import { EventMealData } from "@/lib/api";
import { GuestSegmentMeta } from "@/lib/quoteTotals";

const meal = (over: Partial<EventMealData> = {}): EventMealData => ({
  label: "Welcome drinks", guest_count: 20, price_per_head: "15.00", dishes: [],
  based_on_template: null, meal_time: null, notes: "", ...over,
});

const SEG_META: GuestSegmentMeta[] = [
  { name: "Adults", is_default: true, counts_toward_total: true, price_multiplier: "1.0000", sort_order: 0 },
  { name: "Kids", is_default: false, counts_toward_total: true, price_multiplier: "0.5000", sort_order: 1 },
  { name: "Vendors", is_default: false, counts_toward_total: false, price_multiplier: "0.5000", sort_order: 2 },
];

function setup(meals: EventMealData[], editing = true, extra: Partial<React.ComponentProps<typeof AdditionalMealsEditor>> = {}) {
  const onChange = vi.fn();
  render(<AdditionalMealsEditor meals={meals} onChange={onChange} editing={editing} currencySymbol="£" dateFormat="DD/MM/YYYY" {...extra} />);
  return onChange;
}

describe("AdditionalMealsEditor", () => {
  it("shows an empty state and an Add Meal button when editing", () => {
    setup([]);
    expect(screen.getByText(/No additional meals/i)).toBeInTheDocument();
    expect(screen.getByText("+ Add Meal")).toBeInTheDocument();
  });

  it("adds a blank meal", () => {
    const onChange = setup([]);
    fireEvent.click(screen.getByText("+ Add Meal"));
    expect(onChange).toHaveBeenCalledWith([expect.objectContaining({ label: "", guest_count: 0 })]);
  });

  it("renders an existing meal with its menu and edits the label", () => {
    const onChange = setup([meal({ label: "Breakfast" })]);
    const labelInput = screen.getByDisplayValue("Breakfast");
    expect(screen.getByTestId("menu-builder")).toHaveTextContent("menu:15.00");
    fireEvent.change(labelInput, { target: { value: "Brunch" } });
    expect(onChange).toHaveBeenCalledWith([expect.objectContaining({ label: "Brunch" })]);
  });

  it("removes a meal", () => {
    const onChange = setup([meal({ label: "A" }), meal({ label: "B" })]);
    fireEvent.click(screen.getAllByText("Remove")[0]);
    expect(onChange).toHaveBeenCalledWith([expect.objectContaining({ label: "B" })]);
  });

  // REL-428 moved the per-segment rates into the Main Meal card, which put this
  // asymmetry in plain sight: the main meal prices Kids at their multiplier, an
  // extra meal charges everyone the same. That IS the behaviour (REL-426 AC3
  // deferred per-segment rates on extras) — so it has to be stated, or it reads as
  // a bug. Remove this note only when extras really do price by guest type.
  // REL-447 — found by driving the real app: the Timeline card said 7:00 PM and
  // this card said 8:00 PM for the SAME meal, because this one ran the value
  // through `new Date()` (browser-local) while the timeline and the PDF use the
  // stored time. One meal, two times, one screen.
  it("shows the meal time as STORED, not shifted into the viewer's timezone", () => {
    setup([meal({ meal_time: "2026-09-01T19:00:00Z" })], false);
    expect(screen.getByText(/19:00|7:00 PM/)).toBeInTheDocument();
    expect(screen.queryByText(/20:00|8:00 PM/)).not.toBeInTheDocument();
  });

  it("says the extra meal's price is one flat rate for everyone it serves", () => {
    setup([meal()]);
    expect(screen.getByText(/one flat rate for everyone this meal serves/i)).toBeInTheDocument();
  });

  it("does not show that note in read-only mode", () => {
    setup([meal()], false);
    expect(screen.queryByText(/one flat rate for everyone/i)).not.toBeInTheDocument();
  });

  it("is read-only when not editing (no Add/Remove)", () => {
    setup([meal({ label: "Dinner" })], false);
    expect(screen.queryByText("+ Add Meal")).not.toBeInTheDocument();
    expect(screen.queryByText("Remove")).not.toBeInTheDocument();
    expect(screen.getByText("Dinner")).toBeInTheDocument();
  });

  // REL-426 — "Serves" audience selection + derived count.
  it("hides zero-count segments: a booking with no breakdown shows only Everyone/Guests/Custom", () => {
    setup([meal({ audience: "everyone" })], true, { segmentMeta: SEG_META, guestCount: 150 });
    const serves = screen.getByLabelText("Serves") as HTMLSelectElement;
    expect(Array.from(serves.options).map((o) => o.textContent)).toEqual(["Everyone", "Guests only", "Custom number"]);
  });

  it("lists only the segments used on this booking (data-driven), incl. the derived default", () => {
    // Kids 12 + Vendors 8 entered → Adults (default) becomes a real bucket too.
    setup([meal({ audience: "everyone" })], true,
      { segmentMeta: SEG_META, guestCount: 150, segmentCounts: { Kids: 12, Vendors: 8 } });
    const serves = screen.getByLabelText("Serves") as HTMLSelectElement;
    expect(Array.from(serves.options).map((o) => o.textContent))
      .toEqual(["Everyone", "Guests only", "Adults", "Kids", "Vendors", "Custom number"]);
  });

  it("keeps a meal's own selected segment listed even if its count drops to 0", () => {
    setup([meal({ audience: "segment", audience_segment: "Vendors" })], true,
      { segmentMeta: SEG_META, guestCount: 150, segmentCounts: {} }); // no Vendors count entered
    const serves = screen.getByLabelText("Serves") as HTMLSelectElement;
    expect(Array.from(serves.options).map((o) => o.textContent)).toContain("Vendors");
    expect(serves.value).toBe("seg:Vendors"); // control keeps its value
  });

  it("a derived audience shows a read-only count; Custom shows an editable input", () => {
    // everyone with 150 guests + 8 vendors = 158.
    const onChange = setup([meal({ audience: "everyone", guest_count: 0 })], true,
      { segmentMeta: SEG_META, guestCount: 150, segmentCounts: { Vendors: 8 } });
    expect(screen.getByText("158 — from Everyone")).toBeInTheDocument();
    expect(screen.queryByLabelText("Guest count")).not.toBeInTheDocument();
    // Switch to Custom → the editable number input appears.
    fireEvent.change(screen.getByLabelText("Serves"), { target: { value: "custom" } });
    expect(onChange).toHaveBeenCalledWith([expect.objectContaining({ audience: "custom", audience_segment: null })]);
  });

  it("selecting a segment patches audience + audience_segment", () => {
    // Vendors has a count on the booking, so it's an available "Serves" option.
    const onChange = setup([meal({ audience: "everyone" })], true,
      { segmentMeta: SEG_META, guestCount: 150, segmentCounts: { Vendors: 8 } });
    fireEvent.change(screen.getByLabelText("Serves"), { target: { value: "seg:Vendors" } });
    expect(onChange).toHaveBeenCalledWith([expect.objectContaining({ audience: "segment", audience_segment: "Vendors" })]);
  });
});
