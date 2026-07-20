import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";

import GuestCountField, { GuestCountValue, splitAddsUp } from "./GuestCountField";

const base: GuestCountValue = {
  guest_count: 0, gents: 0, ladies: 0, custom_split: false,
  big_eaters: false, big_eaters_percentage: 0,
};

function setup(over: Partial<GuestCountValue> = {}) {
  const onChange = vi.fn();
  render(<GuestCountField value={{ ...base, ...over }} onChange={onChange} />);
  return onChange;
}

describe("GuestCountField", () => {
  it("editing the count keeps the split unspecified (no fabricated 50/50)", () => {
    const onChange = setup();
    fireEvent.change(screen.getByRole("textbox"), { target: { value: "41" } });
    expect(onChange).toHaveBeenCalledWith({ guest_count: 41, gents: 0, ladies: 0, custom_split: false });
  });

  it("shows the count and 'not specified' when there is no split", () => {
    setup({ guest_count: 50 });
    expect(screen.getByRole("textbox")).toHaveValue("50");
    expect(screen.getByText(/Split: not specified/)).toBeInTheDocument();
  });

  it("opening the split seeds an even suggestion to adjust", () => {
    const onChange = setup({ guest_count: 41 });
    fireEvent.click(screen.getByRole("checkbox", { name: /gents \/ ladies split/i }));
    expect(onChange).toHaveBeenCalledWith({ custom_split: true, gents: 21, ladies: 20 });
  });

  it("editing gents auto-compensates ladies so the split keeps adding up", () => {
    const onChange = setup({ guest_count: 50, gents: 30, ladies: 20, custom_split: true });
    // [count, gents, ladies]
    const [, gents] = screen.getAllByRole("textbox");
    expect(gents).toHaveValue("30");
    fireEvent.change(gents, { target: { value: "35" } });
    expect(onChange).toHaveBeenCalledWith({ gents: 35, ladies: 15 }); // count stays 50
  });

  it("shows the adds-up confirmation when the split matches the count", () => {
    setup({ guest_count: 50, gents: 30, ladies: 20, custom_split: true });
    expect(screen.getByText(/adds up to 50/)).toBeInTheDocument();
  });

  it("changing the count clears an entered split (ask again, never scale)", () => {
    const onChange = setup({ guest_count: 50, gents: 30, ladies: 20, custom_split: true });
    const [count] = screen.getAllByRole("textbox");
    fireEvent.change(count, { target: { value: "60" } });
    expect(onChange).toHaveBeenCalledWith({ guest_count: 60, gents: 0, ladies: 0, custom_split: false });
  });

  it("closing the split clears it back to unspecified", () => {
    const onChange = setup({ guest_count: 50, gents: 35, ladies: 15, custom_split: true });
    fireEvent.click(screen.getByRole("checkbox", { name: /gents \/ ladies split/i }));
    expect(onChange).toHaveBeenCalledWith({ custom_split: false, gents: 0, ladies: 0 });
  });

  it("enables the big-eaters modifier", () => {
    const onChange = setup();
    fireEvent.click(screen.getByRole("checkbox", { name: /hearty eaters/i }));
    expect(onChange).toHaveBeenCalledWith({ big_eaters: true });
  });
});

describe("splitAddsUp", () => {
  it("passes when no split is open", () => {
    expect(splitAddsUp({ guest_count: 50, gents: 0, ladies: 0, custom_split: false })).toBe(true);
  });
  it("passes when the split matches and fails when it does not", () => {
    expect(splitAddsUp({ guest_count: 50, gents: 30, ladies: 20, custom_split: true })).toBe(true);
    expect(splitAddsUp({ guest_count: 50, gents: 30, ladies: 10, custom_split: true })).toBe(false);
  });
});
