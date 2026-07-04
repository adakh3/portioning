import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";

import BookingTimelineField, { BookingTimelineValue } from "./BookingTimelineField";

const base: BookingTimelineValue = { setup_time: "", guest_arrival_time: "", meal_time: "", end_time: "" };

describe("BookingTimelineField", () => {
  it("renders the four timeline fields", () => {
    render(<BookingTimelineField value={base} onChange={() => {}} eventDate="2026-08-01" />);
    for (const label of ["Setup Time", "Guest Arrival", "Meal Time", "End Time"]) {
      expect(screen.getByText(label)).toBeInTheDocument();
    }
  });

  it("anchors an entered time to the event date", () => {
    const onChange = vi.fn();
    render(<BookingTimelineField value={base} onChange={onChange} eventDate="2026-08-01" />);
    // Empty fields show an "Add time" button; reveal the Meal Time dropdowns, pick a time.
    fireEvent.click(screen.getByLabelText("Set Meal Time"));
    fireEvent.change(screen.getByLabelText("Meal Time hour"), { target: { value: "20" } });
    fireEvent.change(screen.getByLabelText("Meal Time minute"), { target: { value: "00" } });
    expect(onChange).toHaveBeenLastCalledWith({ meal_time: "2026-08-01T20:00" });
  });

  it("shows the stored time in the dropdowns", () => {
    render(<BookingTimelineField value={{ ...base, setup_time: "2026-08-01T10:30" }} onChange={() => {}} eventDate="2026-08-01" />);
    expect(screen.getByLabelText("Setup Time hour")).toHaveValue("10");
    expect(screen.getByLabelText("Setup Time minute")).toHaveValue("30");
  });

  it("clears the field via the ✕", () => {
    const onChange = vi.fn();
    render(<BookingTimelineField value={{ ...base, setup_time: "2026-08-01T10:30" }} onChange={onChange} eventDate="2026-08-01" />);
    fireEvent.click(screen.getByLabelText("Clear Setup Time"));
    expect(onChange).toHaveBeenCalledWith({ setup_time: "" });
  });

  it("stays enabled without an event date and anchors the time to today", () => {
    const onChange = vi.fn();
    render(<BookingTimelineField value={base} onChange={onChange} />);
    const setupButton = screen.getByLabelText("Set Setup Time");
    expect(setupButton).not.toBeDisabled();
    fireEvent.click(setupButton);
    fireEvent.change(screen.getByLabelText("Setup Time hour"), { target: { value: "20" } });
    fireEvent.change(screen.getByLabelText("Setup Time minute"), { target: { value: "00" } });
    expect(onChange).toHaveBeenLastCalledWith({ setup_time: expect.stringMatching(/^\d{4}-\d{2}-\d{2}T20:00$/) });
  });

  it("shows an unmistakable empty state (a button, not a fake time)", () => {
    const { rerender } = render(<BookingTimelineField value={base} onChange={() => {}} eventDate="2026-08-01" />);
    // All four empty → four "Add time" buttons, no fake "12:30" to misread.
    expect(screen.getAllByText("+ Add time")).toHaveLength(4);
    // A stored time shows the dropdowns with the value; that field's button is gone.
    rerender(<BookingTimelineField value={{ ...base, setup_time: "2026-08-01T09:30" }} onChange={() => {}} eventDate="2026-08-01" />);
    expect(screen.getByLabelText("Setup Time hour")).toHaveValue("09");
    expect(screen.getAllByText("+ Add time")).toHaveLength(3);
  });
});
