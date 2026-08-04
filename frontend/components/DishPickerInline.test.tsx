import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent, within } from "@testing-library/react";

import DishPickerInline from "./DishPickerInline";
import type { Dish, DishCategory } from "@/lib/api";

// The dish picker's shell (search box, tabs, grouped scroll body) moved into the
// shared `InlinePicker` when the add-on catalogue started using it (REL-454 AC18).
// Nothing about picking a dish may change — and nothing here was pinned before, so
// the refactor could have quietly altered any of it.
const categories = [
  { id: 1, name: "mains", display_name: "Mains", display_order: 2 },
  { id: 2, name: "desserts", display_name: "Desserts", display_order: 1 },
  { id: 3, name: "sides", display_name: "Sides", display_order: 3 },
] as DishCategory[];

const dishes = [
  { id: 11, name: "Roast Beef", category: 1, dietary_tags: [] },
  { id: 12, name: "Beef Wellington", category: 1, dietary_tags: [] },
  { id: 13, name: "Cheesecake", category: 2, dietary_tags: [] },
] as unknown as Dish[];

function renderPicker(onMenu: number[] = [], onAdd = vi.fn(), onClose = vi.fn()) {
  render(
    <DishPickerInline
      dishes={dishes}
      categories={categories}
      onMenuDishIds={new Set(onMenu)}
      onAdd={onAdd}
      onClose={onClose}
      courseName="Main"
    />,
  );
  return { onAdd, onClose };
}

describe("DishPickerInline", () => {
  it("groups dishes by category in display order, with a count each", () => {
    renderPicker();
    const body = screen.getByTestId("dish-picker");
    // Desserts (order 1) before Mains (order 2); Sides has no dishes so it has no group.
    const headings = Array.from(body.querySelectorAll("p")).map((el) => el.textContent);
    expect(headings).toEqual(["Desserts 1", "Mains 2"]);
  });

  it("tabs are All plus only the categories that have dishes", () => {
    renderPicker();
    const tabs = screen.getByTestId("dish-picker-tabs");
    expect(within(tabs).getAllByRole("button").map((b) => b.textContent))
      .toEqual(["All", "Mains", "Desserts"]);

    fireEvent.click(within(tabs).getByText("Desserts"));
    expect(screen.getByLabelText(/^Cheesecake/)).toBeInTheDocument();
    expect(screen.queryByLabelText(/^Roast Beef/)).not.toBeInTheDocument();
  });

  it("search filters by name and says so when nothing matches", () => {
    renderPicker();
    const search = screen.getByLabelText("Search your dishes");
    expect(search).toHaveFocus();

    fireEvent.change(search, { target: { value: "beef" } });
    expect(screen.getByLabelText(/^Roast Beef/)).toBeInTheDocument();
    expect(screen.getByLabelText(/^Beef Wellington/)).toBeInTheDocument();
    expect(screen.queryByLabelText(/^Cheesecake/)).not.toBeInTheDocument();

    fireEvent.change(search, { target: { value: "zzz" } });
    expect(screen.getByText("No dishes match.")).toBeInTheDocument();
  });

  it("adds a dish, and a dish already on the menu is greyed and inert", () => {
    const { onAdd } = renderPicker([13]);
    fireEvent.click(screen.getByLabelText("Roast Beef — add to Main"));
    expect(onAdd).toHaveBeenCalledWith(11);

    const already = screen.getByLabelText("Cheesecake — already on menu");
    expect(already).toBeDisabled();
    expect(already).toHaveTextContent("on menu");
    fireEvent.click(already);
    expect(onAdd).toHaveBeenCalledTimes(1);
  });

  it("closes on Cancel and on esc", () => {
    const { onClose } = renderPicker();
    fireEvent.click(screen.getByText("Cancel"));
    expect(onClose).toHaveBeenCalledTimes(1);
    fireEvent.keyDown(window, { key: "Escape" });
    expect(onClose).toHaveBeenCalledTimes(2);
  });
});
