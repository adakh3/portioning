import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";

import TimeField from "./TimeField";

describe("TimeField", () => {
  it("shows an Add-time button when empty — no fake placeholder to misread", () => {
    render(<TimeField value="" onChange={() => {}} ariaLabel="Setup Time" />);
    expect(screen.getByLabelText("Set Setup Time")).toBeInTheDocument();
    expect(screen.queryByLabelText("Setup Time")).not.toBeInTheDocument(); // no time input rendered yet
  });

  it("reveals the input on click and emits the entered time", () => {
    const onChange = vi.fn();
    render(<TimeField value="" onChange={onChange} ariaLabel="Setup Time" />);
    fireEvent.click(screen.getByLabelText("Set Setup Time"));
    fireEvent.change(screen.getByLabelText("Setup Time"), { target: { value: "09:30" } });
    expect(onChange).toHaveBeenCalledWith("09:30");
  });

  it("shows the value and a clear button when set", () => {
    const onChange = vi.fn();
    render(<TimeField value="14:00" onChange={onChange} ariaLabel="Meal Time" />);
    expect(screen.getByDisplayValue("14:00")).toBeInTheDocument();
    expect(screen.queryByLabelText("Set Meal Time")).not.toBeInTheDocument(); // no button when set
    fireEvent.click(screen.getByLabelText("Clear Meal Time"));
    expect(onChange).toHaveBeenCalledWith("");
  });
});
