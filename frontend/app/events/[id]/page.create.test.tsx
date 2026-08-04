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

// MenuBuilder is NOT mocked here: since REL-451 it IS the menu card, so the course
// affordance this test drives lives inside it.
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
  useFormatDateTime: () => (v: string | null) => v ?? "-",
  useEventTypes: () => ({ data: [{ id: 1, value: "wedding", label: "Wedding" }] }),
  useServiceStyles: () => ({ data: [] }),
  useDishes: () => ({ data: [] }),
  // The one card owns the dish picker and the template list (REL-451).
  useCategories: () => ({ data: [] }),
  useMenus: () => ({ data: [], isLoading: false }),
  useMealTypes: () => ({ data: [] }),
  useTimelinePresets: () => ({ data: [] }),
  useProductLines: () => ({ data: [{ id: 5, name: "Catering", is_active: true, colour: "#000", round_robin_index: 0 }] }),
}));

vi.mock("@/lib/api", () => ({
  api: {
    createEvent: (...args: unknown[]) => { h.createEvent(...args); return Promise.resolve({ id: 55 }); },
    priceEstimate: () => Promise.resolve({ price_per_head: 0, has_unpriced: false }),
    menuPriceCheck: () => Promise.resolve({ adjusted_price: 0, tier_label: "", breakdown: [], total_adjustment: 0 }),
    getMenu: () => Promise.resolve({ portions: [], courses: [], dish_courses: {}, price_tiers: [] }),
  },
  collectErrorMessages: () => [],
}));

import EventCreatePage from "./page";

describe("Event create — guest split + anchored timeline reach the payload", () => {
  beforeEach(() => { h.createEvent.mockClear(); h.push.mockClear(); });

  it("a course added on the form reaches the payload (REL-417)", async () => {
    render(<EventCreatePage />);
    fireEvent.click(screen.getByText("select-customer"));
    fireEvent.change(screen.getByLabelText("Guest Count"), { target: { value: "40" } });

    // A course-less booking is a flat list, so the first course comes from the
    // flat-mode affordance (REL-451 AC8) rather than "+ Add course".
    fireEvent.click(screen.getAllByText("+ Add course")[0]);
    fireEvent.change(screen.getByLabelText("Course 1 name"), { target: { value: "Starter" } });

    fireEvent.click(screen.getByText("Create Event"));

    await waitFor(() => expect(h.createEvent).toHaveBeenCalledTimes(1));
    const payload = h.createEvent.mock.calls[0][0] as Record<string, unknown>;
    expect(payload.courses).toEqual([{ name: "Starter", sort_order: 0 }]);
    expect(payload.dish_courses).toEqual({});
  });

  it("sends the guest count with no fabricated split, and an anchored timeline time", async () => {
    const today = todayISO();
    render(<EventCreatePage />);

    fireEvent.click(screen.getByText("select-customer"));  // event save requires a customer
    fireEvent.change(screen.getByLabelText("Guest Count"), { target: { value: "40" } });
    fireEvent.change(screen.getByLabelText("Meal Time"), { target: { value: "10:00" } });

    fireEvent.click(screen.getByText("Create Event"));

    await waitFor(() => expect(h.createEvent).toHaveBeenCalledTimes(1));
    const payload = h.createEvent.mock.calls[0][0] as Record<string, unknown>;
    expect(payload.guest_count).toBe(40);
    expect(payload.guest_counts).toEqual([]);      // no breakdown entered — never invented
    expect(payload.date).toBe(today);              // defaults to today
    expect(payload.meal_time).toBe(`${today}T10:00`);
    expect(payload.setup_time).toBeNull();
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

  it("an additional meal's Serves selection reaches the payload with a derived count (REL-426)", async () => {
    render(<EventCreatePage />);

    fireEvent.click(screen.getByText("select-customer"));
    fireEvent.change(screen.getByLabelText("Guest Count"), { target: { value: "40" } });
    fireEvent.change(screen.getByLabelText("Ladies"), { target: { value: "15" } });  // Gents 25 derived

    fireEvent.click(screen.getByText("+ Add Meal"));
    fireEvent.change(screen.getByPlaceholderText("Meal label"), { target: { value: "Ladies lunch" } });
    // "Serves" the Ladies segment → its count (15) is derived, read-only.
    fireEvent.change(screen.getByLabelText("Serves"), { target: { value: "seg:Ladies" } });
    expect(screen.getByText("15 — from Ladies")).toBeTruthy();

    fireEvent.click(screen.getByText("Create Event"));

    await waitFor(() => expect(h.createEvent).toHaveBeenCalledTimes(1));
    const payload = h.createEvent.mock.calls[0][0] as { additional_meals: Record<string, unknown>[] };
    expect(payload.additional_meals[0]).toMatchObject({
      label: "Ladies lunch", audience: "segment", audience_segment: "Ladies", guest_count: 15,
    });
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

  // The customer/business pickers are searchable buttons now, so the browser
  // enforces nothing — these guards are the only thing standing between a
  // half-filled form and a saved event. Mirrors the quote-form pair.
  it("refuses to create an event with no customer", async () => {
    render(<EventCreatePage />);
    fireEvent.click(screen.getByText("Create Event"));
    expect(await screen.findByText("Customer is required")).toBeInTheDocument();
    expect(h.createEvent).not.toHaveBeenCalled();
  });

  it("refuses a B2B event with no business", async () => {
    render(<EventCreatePage />);
    fireEvent.click(screen.getByText("select-customer"));
    fireEvent.click(screen.getByLabelText("Business booking (B2B)"));
    fireEvent.click(screen.getByText("Create Event"));
    expect(await screen.findByText("A business is required for a B2B event")).toBeInTheDocument();
    expect(h.createEvent).not.toHaveBeenCalled();
  });
});
