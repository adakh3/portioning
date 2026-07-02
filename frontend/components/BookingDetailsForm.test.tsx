import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";

// Stub the data-fetching child selects so the test focuses on this form's wiring.
vi.mock("@/components/CustomerSelect", () => ({
  default: ({ value, onChange }: { value: string; onChange: (v: string) => void }) => (
    <input aria-label="customer" value={value} onChange={(e) => onChange(e.target.value)} />
  ),
}));
vi.mock("@/components/BusinessSelect", () => ({
  default: ({ value, onChange }: { value: string; onChange: (v: string) => void }) => (
    <input aria-label="business" value={value} onChange={(e) => onChange(e.target.value)} />
  ),
}));
vi.mock("@/components/VenueField", () => ({
  default: ({ address, onAddress }: { address: string; onAddress: (v: string) => void }) => (
    <input aria-label="venue-address" value={address} onChange={(e) => onAddress(e.target.value)} />
  ),
}));

import BookingDetailsForm, { BookingDetailsValue } from "./BookingDetailsForm";

const choices = (vals: [string, string][]) =>
  vals.map(([value, label], i) => ({ id: i + 1, value, label, sort_order: i, is_active: true }));

const baseValue: BookingDetailsValue = {
  contact: "", is_b2b: false, account: "", venue: "", venue_address: "",
  event_type: "", meal_type: "", service_style: "", booking_date: "", notes: "",
};

function renderForm(over: Partial<React.ComponentProps<typeof BookingDetailsForm>> = {}) {
  const onChange = vi.fn();
  render(
    <BookingDetailsForm
      value={baseValue}
      onChange={onChange}
      eventTypes={choices([["wedding", "Wedding"], ["corporate", "Corporate"]])}
      mealTypes={choices([["lunch", "Lunch"]])}
      serviceStyles={choices([["buffet", "Buffet"]])}
      {...over}
    />,
  );
  return onChange;
}

describe("BookingDetailsForm", () => {
  it("renders the shared fields", () => {
    renderForm();
    expect(screen.getByLabelText("customer")).toBeInTheDocument();
    expect(screen.getByLabelText("venue-address")).toBeInTheDocument();
    expect(screen.getByText("Event Type")).toBeInTheDocument();
    expect(screen.getByText("Meal Type")).toBeInTheDocument();
    expect(screen.getByText("Service Style")).toBeInTheDocument();
    expect(screen.getByText("Booking Date")).toBeInTheDocument();
  });

  it("fires onChange with a field patch when a select changes", () => {
    const onChange = renderForm();
    // Comboboxes render in order: event type, meal type, service style.
    fireEvent.change(screen.getAllByRole("combobox")[0], { target: { value: "wedding" } });
    expect(onChange).toHaveBeenCalledWith({ event_type: "wedding" });
  });

  it("maps the customer field to a `contact` patch", () => {
    const onChange = renderForm();
    fireEvent.change(screen.getByLabelText("customer"), { target: { value: "42" } });
    expect(onChange).toHaveBeenCalledWith({ contact: "42" });
  });

  it("only shows the business select when is_b2b is on", () => {
    const onChange = renderForm();
    expect(screen.queryByLabelText("business")).not.toBeInTheDocument();
    // toggling B2B emits the patch (parent flips it; here we just assert the wiring)
    fireEvent.click(screen.getByRole("checkbox"));
    expect(onChange).toHaveBeenCalledWith({ is_b2b: true });
    // when the parent passes is_b2b, the business select appears
    renderForm({ value: { ...baseValue, is_b2b: true } });
    expect(screen.getByLabelText("business")).toBeInTheDocument();
  });

  it("hides notes unless showNotes is set", () => {
    renderForm();
    expect(screen.queryByText("Notes")).not.toBeInTheDocument();
    renderForm({ showNotes: true });
    expect(screen.getByText("Notes")).toBeInTheDocument();
  });

  it("renders the eventDateSlot where provided", () => {
    renderForm({ eventDateSlot: <div>Event Date Slot</div> });
    expect(screen.getByText("Event Date Slot")).toBeInTheDocument();
  });
});
