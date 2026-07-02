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
    // Four empty time inputs, in order: setup, arrival, meal, end.
    const inputs = screen.getAllByDisplayValue("");
    fireEvent.change(inputs[2], { target: { value: "20:00" } });
    expect(onChange).toHaveBeenCalledWith({ meal_time: "2026-08-01T20:00" });
  });

  it("shows only the time part of a stored datetime", () => {
    render(<BookingTimelineField value={{ ...base, setup_time: "2026-08-01T10:30" }} onChange={() => {}} eventDate="2026-08-01" />);
    expect(screen.getByDisplayValue("10:30")).toBeInTheDocument();
  });

  it("clears the field when the time is emptied", () => {
    const onChange = vi.fn();
    render(<BookingTimelineField value={{ ...base, setup_time: "2026-08-01T10:30" }} onChange={onChange} eventDate="2026-08-01" />);
    fireEvent.change(screen.getByDisplayValue("10:30"), { target: { value: "" } });
    expect(onChange).toHaveBeenCalledWith({ setup_time: "" });
  });

  it("prompts for an event date when none is set", () => {
    render(<BookingTimelineField value={base} onChange={() => {}} />);
    expect(screen.getByText(/set the event date first/i)).toBeInTheDocument();
  });
});
