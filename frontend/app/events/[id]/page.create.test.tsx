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
  useSiteSettings: () => ({ data: { currency_symbol: "£", currency_code: "GBP", date_format: "DD/MM/YYYY", price_rounding_step: "50", default_tax_rate: "0.2000", service_charge_default_pct: "20.00", service_charge_taxable_default: false, gratuity_default_pct: "0.00", guest_segments: [{ name: "Gents", is_default: true, counts_toward_total: true, price_multiplier: "1.0000", sort_order: 0 }, { name: "Ladies", is_default: false, counts_toward_total: true, price_multiplier: "1.0000", sort_order: 1 }] } }),
  useDateFormat: () => "DD/MM/YYYY",
  useEventTypes: () => ({ data: [{ id: 1, value: "wedding", label: "Wedding" }] }),
  useServiceStyles: () => ({ data: [] }),
  useMealTypes: () => ({ data: [] }),
  useTimelinePresets: () => ({ data: [] }),
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
    expect(payload.guest_counts).toEqual([]);      // no breakdown entered — never invented
    expect(payload.date).toBe(today);              // defaults to today
    expect(payload.setup_time).toBe(`${today}T10:00`);
    expect(payload.assigned_to).toBe(7);           // defaults to the current user
    expect(payload.product).toBe(5);               // defaults to the org's first active product
  });

  it("sends a breakdown when one is entered (Ladies input → Gents derived)", async () => {
    render(<EventCreatePage />);

    fireEvent.click(screen.getByText("select-customer"));
    fireEvent.change(screen.getByLabelText("Guest Count"), { target: { value: "40" } });
    // Ladies is the explicit input; Gents (the default) is the derived remainder.
    fireEvent.change(screen.getByLabelText("Ladies"), { target: { value: "15" } });

    fireEvent.click(screen.getByText("Create Event"));

    await waitFor(() => expect(h.createEvent).toHaveBeenCalledTimes(1));
    const payload = h.createEvent.mock.calls[0][0] as Record<string, unknown>;
    expect(payload.guest_count).toBe(40);
    expect(payload.guest_counts).toEqual([
      { segment: "Ladies", count: 15 },
      { segment: "Gents", count: 25 }, // derived remainder
    ]);
  });

  it("seeds the org's default service charge into a new event's payload", async () => {
    // Regression: the event create form must snapshot the org's service-charge
    // default (like the quote form) — otherwise it always POSTs 0% and the
    // backend snapshot can't fill a field the payload already sent as "0".
    render(<EventCreatePage />);

    fireEvent.click(screen.getByText("select-customer"));
    fireEvent.change(screen.getByLabelText("Guest Count"), { target: { value: "40" } });

    fireEvent.click(screen.getByText("Create Event"));

    await waitFor(() => expect(h.createEvent).toHaveBeenCalledTimes(1));
    const payload = h.createEvent.mock.calls[0][0] as Record<string, unknown>;
    expect(payload.service_charge_pct).toBe("20.00");    // from OrgSettings, not a hardcoded 0
    expect(payload.service_charge_taxable).toBe(false);  // the flag flows from settings (default state is true)
    expect(payload.gratuity_pct).toBe("0.00");
  });
});
