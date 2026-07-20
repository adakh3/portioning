import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, within } from "@testing-library/react";

const push = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push }),
}));

// useQueryState → plain useState stub (no URL plumbing in tests).
vi.mock("@/lib/useQueryState", async () => {
  const React = await import("react");
  return { useQueryState: (_k: string, init: string) => React.useState(init) };
});

let events: unknown[];
vi.mock("@/lib/hooks", () => ({
  useEvents: () => ({ data: events, error: null, isLoading: false }),
  useSiteSettings: () => ({ data: { currency_symbol: "£" } }),
  useDateFormat: () => "DD/MM/YYYY",
  useUsers: () => ({ data: [{ id: 1, first_name: "Demo", last_name: "Rep" }] }),
  useProductLines: () => ({ data: [{ id: 1, name: "HR" }] }),
  useEventTypes: () => ({ data: [{ value: "wedding", label: "Wedding" }] }),
}));

import EventsPage from "./page";

const mkEvent = (over: Record<string, unknown> = {}) => ({
  id: 1, name: "Smith Wedding", date: "2026-08-01", guest_count: 90, gents: 50, ladies: 40,
  contact_name: "John Smith", account_name: null, assigned_to: 1, assigned_to_name: "Demo Rep",
  created_by: 1, created_by_name: "Demo Rep",
  product: 1, event_type: "wedding", venue_name: "Grand Hall", venue_address: "",
  total: "1200000.00", created_at: "2026-06-01", status: "confirmed", status_display: "Confirmed",
  ...over,
});

beforeEach(() => {
  push.mockClear();
  events = [mkEvent()];
});

describe("Events list", () => {
  it("renders as a table with the customer, salesperson, guests and total", () => {
    render(<EventsPage />);
    expect(screen.getByRole("table")).toBeInTheDocument();
    expect(screen.getByText("Smith Wedding")).toBeInTheDocument();
    expect(screen.getByText("John Smith")).toBeInTheDocument();
    expect(screen.getByText("Demo Rep")).toBeInTheDocument();
    expect(screen.getByText("90")).toBeInTheDocument();      // 50 + 40 guests
    expect(screen.getByText("£1,200,000.00")).toBeInTheDocument();
  });

  it("offers distinct Assigned-to and Created-by filters", () => {
    render(<EventsPage />);
    // Both salesperson filters are present and clearly labelled (not one ambiguous one).
    expect(screen.getByText("Assigned to: All")).toBeInTheDocument();
    expect(screen.getByText("Created by: All")).toBeInTheDocument();
  });

  it("shows a tinted status pill", () => {
    render(<EventsPage />);
    // "Confirmed" also appears as a status filter button — pick the table pill (a span).
    const pill = screen.getAllByText("Confirmed").find((el) => el.tagName === "SPAN");
    expect(pill?.className).toContain("rounded-full");
    expect(pill?.className).toContain("bg-blue-100"); // confirmed → blue
  });

  it("navigates to the event when a row is clicked", () => {
    render(<EventsPage />);
    fireEvent.click(screen.getByText("Smith Wedding"));
    expect(push).toHaveBeenCalledWith("/events/1");
  });

  it("filters by the search box", () => {
    events = [mkEvent(), mkEvent({ id: 2, name: "Jones Party", contact_name: "Amy Jones" })];
    render(<EventsPage />);
    fireEvent.change(screen.getByPlaceholderText(/Search event/i), { target: { value: "jones" } });
    expect(screen.queryByText("Smith Wedding")).not.toBeInTheDocument();
    expect(screen.getByText("Jones Party")).toBeInTheDocument();
  });

  it("sorts by a column header when clicked", () => {
    events = [
      mkEvent({ id: 1, name: "Bravo" }),
      mkEvent({ id: 2, name: "Alpha" }),
    ];
    render(<EventsPage />);
    fireEvent.click(screen.getByRole("columnheader", { name: "Event" })); // sort by name asc
    const rows = screen.getAllByRole("row").slice(1); // drop header
    expect(within(rows[0]).getByText("Alpha")).toBeInTheDocument();
    expect(within(rows[1]).getByText("Bravo")).toBeInTheDocument();
  });
});
