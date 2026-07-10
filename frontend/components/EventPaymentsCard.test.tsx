import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import type { EventData, AuthUser, EventPayment } from "@/lib/api";

const createEventPayment = vi.fn().mockResolvedValue({ id: 9 });
const deleteEventPayment = vi.fn().mockResolvedValue(undefined);
vi.mock("@/lib/api", () => ({
  api: {
    createEventPayment: (...a: unknown[]) => createEventPayment(...a),
    deleteEventPayment: (...a: unknown[]) => deleteEventPayment(...a),
  },
}));

import EventPaymentsCard from "./EventPaymentsCard";

const USERS: AuthUser[] = [
  { id: 1, email: "owner@x.test", first_name: "Olive", last_name: "Owner", role: "owner", organisation: null },
  { id: 2, email: "rep@x.test", first_name: "Ravi", last_name: "Rep", role: "salesperson", organisation: null },
];

function makePayment(over: Partial<EventPayment> = {}): EventPayment {
  return {
    id: 1, event: 10, amount: "400.00", payment_date: "2026-06-01",
    method: "cash", method_display: "Cash", received_by: 1, received_by_name: "Olive Owner",
    reference: "", notes: "", created_at: "2026-06-01T00:00:00Z", ...over,
  };
}

function makeEvent(over: Partial<EventData> = {}): EventData {
  return {
    id: 10, total: "1000.00", amount_paid: "400.00", balance_due: "600.00",
    payment_status: "partial", payments: [makePayment()],
    // only the fields the component reads are needed
    ...over,
  } as unknown as EventData;
}

const onChange = vi.fn();

beforeEach(() => {
  createEventPayment.mockClear();
  deleteEventPayment.mockClear();
  onChange.mockClear();
});

function renderCard(event = makeEvent()) {
  return render(
    <EventPaymentsCard
      event={event} users={USERS} currencySymbol="£" dateFormat="DD/MM/YYYY"
      currentUserId={1} onChange={onChange}
    />,
  );
}

describe("EventPaymentsCard", () => {
  it("shows total, paid, balance and a part-paid status", () => {
    renderCard();
    expect(screen.getByText("£1,000.00")).toBeTruthy();           // total (unique)
    expect(screen.getByText("£600.00")).toBeTruthy();             // balance (unique)
    expect(screen.getAllByText("£400.00").length).toBeGreaterThanOrEqual(1); // paid + row
    expect(screen.getByText("Part paid")).toBeTruthy();
  });

  it("lists recorded payments with received-by", () => {
    renderCard();
    expect(screen.getByText("Olive Owner")).toBeTruthy();
    expect(screen.getByText("Cash")).toBeTruthy();
  });

  it("records a payment → calls the API and refreshes", async () => {
    renderCard();
    fireEvent.click(screen.getByRole("button", { name: "Record Payment" }));
    fireEvent.change(screen.getByPlaceholderText("0.00"), { target: { value: "600" } });
    fireEvent.click(screen.getByRole("button", { name: "Save Payment" }));
    await waitFor(() => expect(createEventPayment).toHaveBeenCalled());
    const [eventId, payload] = createEventPayment.mock.calls[0];
    expect(eventId).toBe(10);
    expect(payload.amount).toBe("600");
    expect(payload.received_by).toBe(1); // defaulted to current user
    await waitFor(() => expect(onChange).toHaveBeenCalled());
  });

  it("deletes a payment → calls the API and refreshes", async () => {
    renderCard();
    fireEvent.click(screen.getByRole("button", { name: "Delete payment" }));
    await waitFor(() => expect(deleteEventPayment).toHaveBeenCalledWith(10, 1));
    await waitFor(() => expect(onChange).toHaveBeenCalled());
  });

  it("shows an empty state when there are no payments", () => {
    renderCard(makeEvent({ payments: [], amount_paid: "0.00", balance_due: "1000.00", payment_status: "unpaid" }));
    expect(screen.getByText("No payments recorded.")).toBeTruthy();
    expect(screen.getByText("Unpaid")).toBeTruthy();
  });
});
