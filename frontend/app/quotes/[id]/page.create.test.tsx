import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";

import { todayISO } from "@/lib/dateFormat";

// These integration tests render the REAL quote create page and drive it through
// the UI, asserting the payload that reaches api.createQuote. They exist to catch
// the class of wiring/payload bugs that only surfaced in manual testing:
//   - the gents/ladies guest split not reaching the payload,
//   - timeline times not anchored/saved,
//   - additional meals (blank label) not saved.
const h = vi.hoisted(() => ({ createQuote: vi.fn(), push: vi.fn() }));

vi.mock("next/navigation", () => ({
  useParams: () => ({ id: "new" }),
  useRouter: () => ({ push: h.push }),
}));

// Stub MenuBuilder (and thus the meal's inner menu) so we don't pull its data hooks.
vi.mock("@/components/MenuBuilder", () => ({ default: () => null }));

vi.mock("@/lib/hooks", () => ({
  useQuote: () => ({ data: null, error: null, isLoading: false, mutate: vi.fn() }),
  useAccounts: () => ({ data: [] }),
  useContacts: () => ({ data: [{ id: 3, name: "Jane Doe", phone: "", account: null }] }),
  useAddOnProducts: () => ({ data: [] }),
  useVenues: () => ({ data: [] }),
  useSiteSettings: () => ({ data: { currency_symbol: "£", currency_code: "GBP", date_format: "DD/MM/YYYY", price_rounding_step: "50", default_tax_rate: "0.2000", service_charge_default_pct: "20.00", service_charge_taxable_default: false, gratuity_default_pct: "0.00" } }),
  useDateFormat: () => "DD/MM/YYYY",
  useEventTypes: () => ({ data: [{ id: 1, value: "wedding", label: "Wedding" }] }),
  useServiceStyles: () => ({ data: [] }),
  useMealTypes: () => ({ data: [] }),
  useAllLeads: () => ({ data: [] }),
  useProductLines: () => ({ data: [{ id: 5, name: "Catering", is_active: true, colour: "#000", round_robin_index: 0 }] }),
  useUsers: () => ({ data: [] }),
  revalidate: vi.fn(),
}));

vi.mock("@/lib/auth", () => ({
  useAuth: () => ({ user: { id: 4, first_name: "Olivia", last_name: "Owner", role: "owner" } }),
}));

vi.mock("@/lib/api", () => ({
  api: {
    createQuote: (...args: unknown[]) => { h.createQuote(...args); return Promise.resolve({ id: 99 }); },
    getAccount: () => Promise.resolve({ contacts: [] }),
  },
}));

import QuoteCreatePage from "./page";

describe("Quote create — guest split, timeline, meals reach the payload", () => {
  beforeEach(() => { h.createQuote.mockClear(); h.push.mockClear(); });

  it("sends the guest count, an anchored timeline time, and an additional meal", async () => {
    const today = todayISO();
    render(<QuoteCreatePage />);

    // 1) Guest count is the number; the split stays unspecified unless opened.
    fireEvent.change(screen.getByLabelText("Guest Count"), { target: { value: "40" } });

    // 2) A timeline time → anchored to the (defaulted-to-today) event date.
    fireEvent.change(screen.getByLabelText("Setup Time"), { target: { value: "10:00" } });

    // 3) An additional meal with a blank label + its own time.
    fireEvent.click(screen.getByText("+ Add Meal"));
    fireEvent.change(await screen.findByLabelText("Additional meal time"), { target: { value: "14:00" } });

    fireEvent.click(screen.getByText("Create Quote"));

    await waitFor(() => expect(h.createQuote).toHaveBeenCalledTimes(1));
    const payload = h.createQuote.mock.calls[0][0] as Record<string, unknown>;

    // Guest count primary; split not specified — never invented
    expect(payload.guest_count).toBe(40);
    expect(payload.gents).toBe(0);
    expect(payload.ladies).toBe(0);
    // Event date defaults to today (not empty → no "wrong format")
    expect(payload.event_date).toBe(today);
    // Timeline time anchored to the event date
    expect(payload.setup_time).toBe(`${today}T10:00`);
    // Product defaults to the org's first active line
    expect(payload.product).toBe(5);
    // Meal: inherits total guests, blank label allowed, time anchored
    expect(payload.additional_meals).toEqual([
      expect.objectContaining({ guest_count: 40, label: "", meal_time: `${today}T14:00` }),
    ]);
  });

  it("seeds the org's default service charge into a new quote's payload", async () => {
    // Mirror of the event-form guard: the quote form must snapshot the org's
    // service-charge default so a US org's 20% reaches api.createQuote.
    render(<QuoteCreatePage />);

    fireEvent.change(screen.getByLabelText("Guest Count"), { target: { value: "40" } });

    fireEvent.click(screen.getByText("Create Quote"));

    await waitFor(() => expect(h.createQuote).toHaveBeenCalledTimes(1));
    const payload = h.createQuote.mock.calls[0][0] as Record<string, unknown>;
    expect(payload.service_charge_pct).toBe("20.00");    // from OrgSettings, not a hardcoded 0
    expect(payload.service_charge_taxable).toBe(false);  // the flag flows from settings (default state is true)
    expect(payload.gratuity_pct).toBe("0.00");
  });
});
