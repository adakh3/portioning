import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";

import TimeField from "./TimeField";

describe("TimeField", () => {
  it("is a single dropdown, empty by default, with 24h slot labels", () => {
    render(<TimeField value="" onChange={() => {}} ariaLabel="Setup Time" />);
    expect(screen.getByLabelText("Setup Time")).toHaveValue("");
    expect(screen.getByRole("option", { name: "19:00" })).toBeInTheDocument();
    expect(screen.getByRole("option", { name: "19:30" })).toBeInTheDocument();
  });

  it("emits the 24h HH:MM value when a slot is chosen", () => {
    const onChange = vi.fn();
    render(<TimeField value="" onChange={onChange} ariaLabel="Setup Time" />);
    fireEvent.change(screen.getByLabelText("Setup Time"), { target: { value: "14:30" } });
    expect(onChange).toHaveBeenCalledWith("14:30");
  });

  it("labels slots per the org format (12h → AM/PM), value stays 24h", () => {
    render(<TimeField value="19:00" onChange={() => {}} ariaLabel="Meal Time" format="12h" />);
    expect(screen.getByLabelText("Meal Time")).toHaveValue("19:00");
    expect(screen.getByRole("option", { name: "7:00 PM" })).toBeInTheDocument();
    expect(screen.getByRole("option", { name: "12:30 AM" })).toBeInTheDocument();
  });

  it("keeps an off-grid stored time (07:15) as a selectable option", () => {
    render(<TimeField value="07:15" onChange={() => {}} ariaLabel="Setup Time" />);
    expect(screen.getByLabelText("Setup Time")).toHaveValue("07:15");
    expect(screen.getByRole("option", { name: "07:15" })).toBeInTheDocument();
  });

  it("clears via the — Not set — option", () => {
    const onChange = vi.fn();
    render(<TimeField value="14:00" onChange={onChange} ariaLabel="Meal Time" />);
    fireEvent.change(screen.getByLabelText("Meal Time"), { target: { value: "" } });
    expect(onChange).toHaveBeenCalledWith("");
  });
});
