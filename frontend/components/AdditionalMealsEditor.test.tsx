import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";

// MenuBuilder pulls in SWR/data; stub it to a marker so we test this editor's own wiring.
vi.mock("@/components/MenuBuilder", () => ({
  default: ({ pricePerHead }: { pricePerHead: string }) => <div data-testid="menu-builder">menu:{pricePerHead}</div>,
}));
vi.mock("@/lib/dateFormat", () => ({ formatDateTime: (s: string) => `fmt(${s})`, formatTime: (s: string) => s }));

import AdditionalMealsEditor from "./AdditionalMealsEditor";
import { EventMealData } from "@/lib/api";

const meal = (over: Partial<EventMealData> = {}): EventMealData => ({
  label: "Welcome drinks", guest_count: 20, price_per_head: "15.00", dishes: [],
  based_on_template: null, meal_time: null, notes: "", ...over,
});

function setup(meals: EventMealData[], editing = true) {
  const onChange = vi.fn();
  render(<AdditionalMealsEditor meals={meals} onChange={onChange} editing={editing} currencySymbol="£" dateFormat="DD/MM/YYYY" />);
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

  it("is read-only when not editing (no Add/Remove)", () => {
    setup([meal({ label: "Dinner" })], false);
    expect(screen.queryByText("+ Add Meal")).not.toBeInTheDocument();
    expect(screen.queryByText("Remove")).not.toBeInTheDocument();
    expect(screen.getByText("Dinner")).toBeInTheDocument();
  });
});
