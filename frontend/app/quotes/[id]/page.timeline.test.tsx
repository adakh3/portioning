import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";

// REL-418 AC1/AC2/AC7 on the QUOTE form, create AND edit: drive the real page and
// assert the `timeline_entries` that reach api.createQuote / api.updateQuote.
// Unit-testing the payload builder isn't enough — field → state → payload is
// exactly where this class of bug hides.
const h = vi.hoisted(() => ({ createQuote: vi.fn(), updateQuote: vi.fn(), push: vi.fn(), id: "new" }));

vi.mock("next/navigation", () => ({
  useParams: () => ({ id: h.id }),
  useRouter: () => ({ push: h.push }),
}));

vi.mock("@/components/MenuBuilder", () => ({ default: () => null }));

const existingQuote = {
  id: 7, version: 1, status: "draft", status_display: "Draft", is_editable: true,
  lead: null, primary_contact: 3, is_b2b: false, account: null,
  event_date: "2026-09-01", venue: null, venue_address: "",
  venue_city: "", venue_state: "", venue_zip: "",
  product: 5, guest_count: 40, gents: 0, ladies: 0, guest_counts: [],
  big_eaters: false, big_eaters_percentage: 0, price_per_head: "25.00",
  event_type: "wedding", meal_type: "", booking_date: "", service_style: "", valid_until: "",
  setup_time: null, guest_arrival_time: null, meal_time: null, end_time: null,
  timeline_entries: [
    { id: 11, time: "17:00:00", label: "Cocktail hour", sort_order: 0 },
    { id: 12, time: "18:30:00", label: "Dinner service", sort_order: 1 },
  ],
  is_taxable: true, subtotal: "1000.00", tax_rate: "0.2000", tax_amount: "200.00", total: "1200.00",
  service_charge_pct: "0", service_charge_taxable: true, service_charge: "0.00",
  gratuity_pct: "0", gratuity: "0.00",
  dishes: [], dish_names: [], based_on_template: null, additional_meals: [],
  notes: "", internal_notes: "", line_items: [], food_total: "1000.00",
  created_at: "", updated_at: "", sent_at: null, accepted_at: null,
  public_token: null, signature: null, event: null, created_by: null, assigned_to: null,
};

vi.mock("@/lib/hooks", () => ({
  useQuote: () => ({ data: h.id === "new" ? null : existingQuote, error: null, isLoading: false, mutate: vi.fn() }),
  useAccounts: () => ({ data: [] }),
  useContacts: () => ({ data: [{ id: 3, name: "Jane Doe", phone: "", account: null }] }),
  useAddOnProducts: () => ({ data: [] }),
  useVenues: () => ({ data: [] }),
  useSiteSettings: () => ({ data: { currency_symbol: "$", currency_code: "USD", date_format: "DD/MM/YYYY", price_rounding_step: "50", default_tax_rate: "0.2000", service_charge_default_pct: "0", service_charge_taxable_default: true, gratuity_default_pct: "0.00" } }),
  useDateFormat: () => "DD/MM/YYYY",
  useEventTypes: () => ({ data: [{ id: 1, value: "wedding", label: "Wedding" }] }),
  useServiceStyles: () => ({ data: [] }),
  useMealTypes: () => ({ data: [] }),
  useTimelinePresets: () => ({ data: [{ id: 1, value: "cocktail_hour", label: "Cocktail hour" }] }),
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
    updateQuote: (...args: unknown[]) => { h.updateQuote(...args); return Promise.resolve({ id: 7 }); },
    getAccount: () => Promise.resolve({ contacts: [] }),
  },
}));

import QuotePage from "./page";

describe("Quote form — the run-of-show reaches the payload", () => {
  beforeEach(() => {
    h.createQuote.mockClear();
    h.updateQuote.mockClear();
    h.id = "new";
  });

  it("CREATE: a new quote sends its entries in the order they were built", async () => {
    render(<QuotePage />);

    fireEvent.change(screen.getByLabelText("Guest Count"), { target: { value: "40" } });
    fireEvent.click(screen.getByText("+ Build a run-of-show"));

    fireEvent.change(await screen.findByLabelText("Step 1 time"), { target: { value: "17:00" } });
    fireEvent.change(screen.getByLabelText("Step 1 label"), { target: { value: "Cocktail hour" } });
    fireEvent.click(screen.getByText("+ Add step"));
    fireEvent.change(await screen.findByLabelText("Step 2 time"), { target: { value: "18:30" } });
    fireEvent.change(screen.getByLabelText("Step 2 label"), { target: { value: "Dinner service" } });

    fireEvent.click(screen.getByText("Create Quote"));

    await waitFor(() => expect(h.createQuote).toHaveBeenCalledTimes(1));
    const payload = h.createQuote.mock.calls[0][0] as Record<string, unknown>;
    expect(payload.timeline_entries).toEqual([
      { time: "17:00:00", label: "Cocktail hour" },
      { time: "18:30:00", label: "Dinner service" },
    ]);
  });

  it("CREATE: no run-of-show ⇒ an empty list, and the legacy slot still saves", async () => {
    render(<QuotePage />);

    fireEvent.change(screen.getByLabelText("Guest Count"), { target: { value: "40" } });
    fireEvent.change(screen.getByLabelText("Setup Time"), { target: { value: "10:00" } });
    fireEvent.click(screen.getByText("Create Quote"));

    await waitFor(() => expect(h.createQuote).toHaveBeenCalledTimes(1));
    const payload = h.createQuote.mock.calls[0][0] as Record<string, unknown>;
    expect(payload.timeline_entries).toEqual([]);
    expect(payload.setup_time).toMatch(/T10:00$/);
  });

  it("CREATE: a step added but not labelled still reaches the payload", async () => {
    // Regression: the first click on "+ Build a run-of-show" makes a blank-label
    // row. It must save, not 400 the whole quote.
    render(<QuotePage />);

    fireEvent.change(screen.getByLabelText("Guest Count"), { target: { value: "40" } });
    fireEvent.click(screen.getByText("+ Build a run-of-show"));
    fireEvent.click(screen.getByText("Create Quote"));

    await waitFor(() => expect(h.createQuote).toHaveBeenCalledTimes(1));
    const payload = h.createQuote.mock.calls[0][0] as Record<string, unknown>;
    expect(payload.timeline_entries).toEqual([{ time: "17:00:00", label: "" }]);
  });

  it("EDIT: existing entries hydrate, and a reorder is what gets saved", async () => {
    h.id = "7";
    render(<QuotePage />);

    fireEvent.click(await screen.findByText("Edit Quote"));

    // Hydrated from the API's "HH:MM:SS" into the editor's "HH:MM".
    expect(await screen.findByLabelText("Step 1 label")).toHaveValue("Cocktail hour");
    expect(screen.getByLabelText("Step 1 time")).toHaveValue("17:00");

    fireEvent.click(screen.getByLabelText("Move step 2 up"));
    fireEvent.click(screen.getByText("Save Quote"));

    await waitFor(() => expect(h.updateQuote).toHaveBeenCalledTimes(1));
    const payload = h.updateQuote.mock.calls[0][1] as Record<string, unknown>;
    expect(payload.timeline_entries).toEqual([
      { time: "18:30:00", label: "Dinner service" },
      { time: "17:00:00", label: "Cocktail hour" },
    ]);
  });

  it("EDIT: removing every step sends an empty list, so the legacy slots come back", async () => {
    h.id = "7";
    render(<QuotePage />);

    fireEvent.click(await screen.findByText("Edit Quote"));
    fireEvent.click(await screen.findByLabelText("Remove step 1"));
    fireEvent.click(screen.getByLabelText("Remove step 1"));
    fireEvent.click(screen.getByText("Save Quote"));

    await waitFor(() => expect(h.updateQuote).toHaveBeenCalledTimes(1));
    const payload = h.updateQuote.mock.calls[0][1] as Record<string, unknown>;
    expect(payload.timeline_entries).toEqual([]);
  });
});
