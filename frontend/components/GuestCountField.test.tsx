import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";

import GuestCountField, { GuestCountValue } from "./GuestCountField";

const base: GuestCountValue = { gents: 0, ladies: 0, custom_split: false, big_eaters: false, big_eaters_percentage: 0 };

function setup(over: Partial<GuestCountValue> = {}) {
  const onChange = vi.fn();
  render(<GuestCountField value={{ ...base, ...over }} onChange={onChange} />);
  return onChange;
}

describe("GuestCountField", () => {
  it("auto-splits the total 50/50 (ceil gents, floor ladies)", () => {
    const onChange = setup();
    // Not custom, no big eaters → the only input is Total Guests.
    fireEvent.change(screen.getByRole("textbox"), { target: { value: "41" } });
    expect(onChange).toHaveBeenCalledWith({ gents: 21, ladies: 20 });
  });

  it("derives the total and shows the split hint", () => {
    setup({ gents: 30, ladies: 20 }); // total 50
    expect(screen.getByRole("textbox")).toHaveValue("50");
    expect(screen.getByText(/Split: 25 gents \/ 25 ladies/)).toBeInTheDocument();
  });

  it("reveals gents/ladies when Customise split is on and keeps the total", () => {
    const onChange = setup({ gents: 30, ladies: 20, custom_split: true });
    // [total, gents, ladies]
    const [, gents] = screen.getAllByRole("textbox");
    expect(gents).toHaveValue("30");
    fireEvent.change(gents, { target: { value: "35" } });
    expect(onChange).toHaveBeenCalledWith({ gents: 35, ladies: 15 }); // total stays 50
  });

  it("toggling custom split off resets to 50/50", () => {
    const onChange = setup({ gents: 35, ladies: 15, custom_split: true }); // total 50
    fireEvent.click(screen.getByRole("checkbox", { name: /customise gender split/i }));
    expect(onChange).toHaveBeenCalledWith({ custom_split: false, gents: 25, ladies: 25 });
  });

  it("enables the big-eaters modifier", () => {
    const onChange = setup();
    fireEvent.click(screen.getByRole("checkbox", { name: /big eaters/i }));
    expect(onChange).toHaveBeenCalledWith({ big_eaters: true });
  });
});
