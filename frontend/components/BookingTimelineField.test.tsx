import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";

import BookingTimelineField, { BookingTimelineValue } from "./BookingTimelineField";

const base: BookingTimelineValue = { setup_time: "", guest_arrival_time: "", meal_time: "", end_time: "" };

describe("BookingTimelineField", () => {
  it("renders the four timeline fields", () => {
    render(<BookingTimelineField value={base} onChange={() => {}} />);
    for (const label of ["Setup Time", "Guest Arrival Time", "Meal Time", "End Time"]) {
      expect(screen.getByText(label)).toBeInTheDocument();
    }
  });

  it("emits a patch keyed by the edited field", () => {
    const onChange = vi.fn();
    render(<BookingTimelineField value={base} onChange={onChange} />);
    // Fields render in order: setup, arrival, meal, end.
    const inputs = screen.getAllByDisplayValue("");
    fireEvent.change(inputs[2], { target: { value: "2026-09-01T20:00" } });
    expect(onChange).toHaveBeenCalledWith({ meal_time: "2026-09-01T20:00" });
  });
});
