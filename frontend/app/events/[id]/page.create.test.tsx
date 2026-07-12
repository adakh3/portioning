import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";

import { todayISO } from "@/lib/dateFormat";

// Integration test for the EVENT create page — the same guest-split + timeline
// wiring as quotes (shared components), asserted end-to-end into api.createEvent.
const h = vi.hoisted(() => ({ createEvent: vi.fn(), push: vi.fn() }));

vi.mock("next/navigation", () => ({
  useParams: () => ({ id: "new" }),
  useRouter: () => ({ push: h.push }),
  useSearchParams: () => ({ get: () => null }),
}));

vi.mock("@/components/MenuBuilder", () => ({ default: () => null }));
vi.mock("@/components/DealWonDialog", () => ({ default: () => null }));
vi.mock("@/lib/auth", () => ({
  useAuth: () => ({ user: { id: 7, first_name: "Sam", last_name: "Sales", role: "salesperson" } }),
}));
// Stub the customer picker: one click selects contact 3 (event save requires it).
vi.mock("@/components/CustomerSelect", () => ({
  default: ({ onChange }: { onChange: (v: string) => void }) => (
    <button type="button" onClick={() => onChange("3")}>select-customer</button>
  ),
}));

vi.mock("@/lib/hooks", () => ({
  useEvent: () => ({ data: null, error: null, isLoading: false, mutate: vi.fn() }),
  useAccounts: () => ({ data: [] }),
  useContacts: () => ({ data: [{ id: 3, name: "Jane Doe", phone: "", account: null }] }),
  useVenues: () => ({ data: [] }),
  useAddOnProducts: () => ({ data: [] }),
  useLaborRoles: () => ({ data: [] }),
  useStaff: () => ({ data: [] }),
  useUsers: () => ({ data: [] }),
  useSiteSettings: () => ({ data: { currency_symbol: "£", currency_code: "GBP", date_format: "DD/MM/YYYY", price_rounding_step: "50", default_tax_rate: "0.2000" } }),
  useDateFormat: () => "DD/MM/YYYY",
  useEventTypes: () => ({ data: [{ id: 1, value: "wedding", label: "Wedding" }] }),
  useServiceStyles: () => ({ data: [] }),
  useMealTypes: () => ({ data: [] }),
  useProductLines: () => ({ data: [{ id: 5, name: "Catering", is_active: true, colour: "#000", round_robin_index: 0 }] }),
}));

vi.mock("@/lib/api", () => ({
  api: {
    createEvent: (...args: unknown[]) => { h.createEvent(...args); return Promise.resolve({ id: 55 }); },
  },
}));

import EventCreatePage from "./page";

describe("Event create — guest split + anchored timeline reach the payload", () => {
  beforeEach(() => { h.createEvent.mockClear(); h.push.mockClear(); });

  it("sends the guest count with no fabricated split, and an anchored timeline time", async () => {
    const today = todayISO();
    render(<EventCreatePage />);

    fireEvent.click(screen.getByText("select-customer"));  // event save requires a customer
    fireEvent.change(screen.getByLabelText("Guest Count"), { target: { value: "40" } });
    fireEvent.change(screen.getByLabelText("Setup Time"), { target: { value: "10:00" } });

    fireEvent.click(screen.getByText("Create Event"));

    await waitFor(() => expect(h.createEvent).toHaveBeenCalledTimes(1));
    const payload = h.createEvent.mock.calls[0][0] as Record<string, unknown>;
    expect(payload.guest_count).toBe(40);
    expect(payload.gents).toBe(0);                 // split not specified — never invented
    expect(payload.ladies).toBe(0);
    expect(payload.date).toBe(today);              // defaults to today
    expect(payload.setup_time).toBe(`${today}T10:00`);
    expect(payload.assigned_to).toBe(7);           // defaults to the current user
    expect(payload.product).toBe(5);               // defaults to the org's first active product
  });

  it("sends a real gents/ladies split when one is entered", async () => {
    render(<EventCreatePage />);

    fireEvent.click(screen.getByText("select-customer"));
    fireEvent.change(screen.getByLabelText("Guest Count"), { target: { value: "40" } });
    fireEvent.click(screen.getByRole("checkbox", { name: /gents \/ ladies split/i }));
    fireEvent.change(screen.getByLabelText("Gents"), { target: { value: "25" } });

    fireEvent.click(screen.getByText("Create Event"));

    await waitFor(() => expect(h.createEvent).toHaveBeenCalledTimes(1));
    const payload = h.createEvent.mock.calls[0][0] as Record<string, unknown>;
    expect(payload.guest_count).toBe(40);
    expect(payload.gents).toBe(25);
    expect(payload.ladies).toBe(15);               // auto-compensated to add up
  });
});
