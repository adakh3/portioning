import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";

// Hoisted so the vi.mock factories (which run before top-level consts) can use it.
const h = vi.hoisted(() => ({
  updateQuote: vi.fn(),
  mutateQuote: vi.fn(),
  quote: {
    id: 1, is_b2b: false, account: null, account_name: null, status: "draft", version: 1,
    event_date: "2026-09-01", guest_count: 100, event_type: "wedding",
    meal_type: "", service_style: "", booking_date: "",
    venue: null, venue_name: null, venue_address: "",
    price_per_head: "50.00", tax_rate: "0.2000", valid_until: "",
    primary_contact: 3, contact_name: "Jane Doe", contact_email: null, contact_phone: null,
    notes: "", internal_notes: "", dishes: [], based_on_template: null,
    line_items: [], subtotal: "5000.00", tax_amount: "1000.00", total: "6000.00",
    food_total: "5000.00", is_editable: true, event_id: null,
    created_at: "", updated_at: "",
  },
}));

vi.mock("next/navigation", () => ({
  useParams: () => ({ id: "1" }),
  useRouter: () => ({ push: vi.fn() }),
}));

// Stub MenuBuilder so we don't pull in its own data hooks.
vi.mock("@/components/MenuBuilder", () => ({ default: () => null }));

vi.mock("@/lib/hooks", () => ({
  useQuote: () => ({ data: h.quote, error: null, isLoading: false, mutate: h.mutateQuote }),
  useAccounts: () => ({ data: [] }),
  useContacts: () => ({ data: [{ id: 3, name: "Jane Doe", phone: "", account: null }] }),
  useAddOnProducts: () => ({ data: [] }),
  useVenues: () => ({ data: [] }),
  useSiteSettings: () => ({ data: { currency_symbol: "£", currency_code: "GBP", date_format: "DD/MM/YYYY", price_rounding_step: "50" } }),
  useDateFormat: () => "DD/MM/YYYY",
  useEventTypes: () => ({ data: [{ id: 1, value: "wedding", label: "Wedding" }] }),
  useServiceStyles: () => ({ data: [] }),
  useMealTypes: () => ({ data: [] }),
  useAllLeads: () => ({ data: [] }),
  revalidate: vi.fn(),
}));

vi.mock("@/lib/api", () => ({
  api: {
    updateQuote: (...args: unknown[]) => { h.updateQuote(...args); return Promise.resolve(h.quote); },
    getAccount: () => Promise.resolve({ contacts: [] }),
  },
}));

import QuoteDetailPage from "./page";

describe("Quote detail — one quote, one save", () => {
  beforeEach(() => h.updateQuote.mockClear());

  it("commits the whole quote (fields + dishes + line items) in a single updateQuote call", async () => {
    render(<QuoteDetailPage />);

    fireEvent.click(screen.getByText("Edit Quote"));
    fireEvent.click(await screen.findByText("Save Quote"));

    await waitFor(() => expect(h.updateQuote).toHaveBeenCalledTimes(1));
    expect(h.updateQuote).toHaveBeenCalledWith(
      1,
      expect.objectContaining({
        price_per_head: "50.00", // the menu price now saves WITH everything else
        dish_ids: [],
        line_items: expect.any(Array),
      }),
    );
  });
});
