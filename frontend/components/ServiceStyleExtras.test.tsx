import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";

import ServiceStyleExtras from "./ServiceStyleExtras";

// The Settings control that decides whether a service style offers the guest a
// choice of dish (REL-452). It replaced a hardcoded check for the slug "plated" —
// which an admin could neither see nor set, because slugs are generated from
// labels and never shown.

const style = (over: Record<string, unknown> = {}) => ({
  id: 7, value: "dropoff", label: "Drop-off / Delivery", sort_order: 5, is_active: true,
  ...over,
});

describe("ServiceStyleExtras", () => {
  it("reflects the style's current flag", () => {
    const { rerender } = render(<ServiceStyleExtras option={style()} patch={vi.fn()} />);
    expect(screen.getByRole("checkbox")).not.toBeChecked();
    rerender(<ServiceStyleExtras option={style({ guests_choose: true })} patch={vi.fn()} />);
    expect(screen.getByRole("checkbox")).toBeChecked();
  });

  it("ticking it patches only the flag", () => {
    // The boxed-lunch case: everyone pre-picks, so this style should offer choices
    // even though it isn't called "plated".
    const patch = vi.fn();
    render(<ServiceStyleExtras option={style()} patch={patch} />);
    fireEvent.click(screen.getByRole("checkbox"));
    expect(patch).toHaveBeenCalledWith({ guests_choose: true });
  });

  it("unticking it patches false, rather than dropping the field", () => {
    // AC8 — turning it off must be an explicit false the API stores; the marked
    // choices on existing bookings stay put and simply stop rendering.
    const patch = vi.fn();
    render(<ServiceStyleExtras option={style({ guests_choose: true })} patch={patch} />);
    fireEvent.click(screen.getByRole("checkbox"));
    expect(patch).toHaveBeenCalledWith({ guests_choose: false });
  });

  it("names the style it belongs to, so a row of checkboxes is readable", () => {
    render(<ServiceStyleExtras option={style()} patch={vi.fn()} />);
    expect(
      screen.getByLabelText("Guests choose between dishes on Drop-off / Delivery"),
    ).toBeInTheDocument();
  });
});
