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

  it("anchors a chosen slot to the event date", () => {
    const onChange = vi.fn();
    render(<BookingTimelineField value={base} onChange={onChange} eventDate="2026-08-01" />);
    fireEvent.change(screen.getByLabelText("Meal Time"), { target: { value: "20:00" } });
    expect(onChange).toHaveBeenLastCalledWith({ meal_time: "2026-08-01T20:00" });
  });

  it("shows the stored time in the dropdown", () => {
    render(<BookingTimelineField value={{ ...base, setup_time: "2026-08-01T10:30" }} onChange={() => {}} eventDate="2026-08-01" />);
    expect(screen.getByLabelText("Setup Time")).toHaveValue("10:30");
  });

  it("clears the field via the — Not set — option", () => {
    const onChange = vi.fn();
    render(<BookingTimelineField value={{ ...base, setup_time: "2026-08-01T10:30" }} onChange={onChange} eventDate="2026-08-01" />);
    fireEvent.change(screen.getByLabelText("Setup Time"), { target: { value: "" } });
    expect(onChange).toHaveBeenCalledWith({ setup_time: "" });
  });

  it("stays enabled without an event date and anchors the time to today", () => {
    const onChange = vi.fn();
    render(<BookingTimelineField value={base} onChange={onChange} />);
    const setup = screen.getByLabelText("Setup Time");
    expect(setup).not.toBeDisabled();
    fireEvent.change(setup, { target: { value: "20:00" } });
    expect(onChange).toHaveBeenLastCalledWith({ setup_time: expect.stringMatching(/^\d{4}-\d{2}-\d{2}T20:00$/) });
  });

  it("empty fields show — Not set —; a stored field shows its value", () => {
    const { rerender } = render(<BookingTimelineField value={base} onChange={() => {}} eventDate="2026-08-01" />);
    expect(screen.getByLabelText("Setup Time")).toHaveValue("");
    rerender(<BookingTimelineField value={{ ...base, setup_time: "2026-08-01T09:30" }} onChange={() => {}} eventDate="2026-08-01" />);
    expect(screen.getByLabelText("Setup Time")).toHaveValue("09:30");
  });
});
