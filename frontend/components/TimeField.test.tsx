import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";

import TimeField from "./TimeField";

describe("TimeField", () => {
  it("shows an Add-time button when empty — no fake placeholder to misread", () => {
    render(<TimeField value="" onChange={() => {}} ariaLabel="Setup Time" />);
    expect(screen.getByLabelText("Set Setup Time")).toBeInTheDocument();
    expect(screen.queryByLabelText("Setup Time hour")).not.toBeInTheDocument();
  });

  it("reveals hour/minute dropdowns on click and emits HH:MM once both are chosen", () => {
    const onChange = vi.fn();
    render(<TimeField value="" onChange={onChange} ariaLabel="Setup Time" />);
    fireEvent.click(screen.getByLabelText("Set Setup Time"));
    fireEvent.change(screen.getByLabelText("Setup Time hour"), { target: { value: "09" } });
    fireEvent.change(screen.getByLabelText("Setup Time minute"), { target: { value: "30" } });
    expect(onChange).toHaveBeenLastCalledWith("09:30");
  });

  it("shows the value in the dropdowns and clears via the ✕", () => {
    const onChange = vi.fn();
    render(<TimeField value="14:00" onChange={onChange} ariaLabel="Meal Time" />);
    expect(screen.getByLabelText("Meal Time hour")).toHaveValue("14");
    expect(screen.getByLabelText("Meal Time minute")).toHaveValue("00");
    fireEvent.click(screen.getByLabelText("Clear Meal Time"));
    expect(onChange).toHaveBeenCalledWith("");
  });

  it("12h mode: entering 2:30 PM emits the stored 24h value 14:30", () => {
    const onChange = vi.fn();
    render(<TimeField value="" onChange={onChange} ariaLabel="Setup Time" format="12h" />);
    fireEvent.click(screen.getByLabelText("Set Setup Time"));
    fireEvent.change(screen.getByLabelText("Setup Time hour"), { target: { value: "2" } });
    fireEvent.change(screen.getByLabelText("Setup Time minute"), { target: { value: "30" } });
    fireEvent.change(screen.getByLabelText("Setup Time AM/PM"), { target: { value: "PM" } });
    expect(onChange).toHaveBeenLastCalledWith("14:30");
  });

  it("12h mode: shows a stored 24h value as 12-hour + PM", () => {
    render(<TimeField value="19:00" onChange={() => {}} ariaLabel="Meal Time" format="12h" />);
    expect(screen.getByLabelText("Meal Time hour")).toHaveValue("7");
    expect(screen.getByLabelText("Meal Time AM/PM")).toHaveValue("PM");
  });
});
