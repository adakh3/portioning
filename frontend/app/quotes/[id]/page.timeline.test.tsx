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
  // REL-445: the quote/event pages read their client-message ledger and
  // channel availability from these; unmocked they blow up the whole page.
  useClientMessages: () => ({ data: [], isLoading: false, mutate: vi.fn() }),
  useMessagingStatus: () => ({ data: undefined }),
  useQuote: () => ({ data: h.id === "new" ? null : existingQuote, error: null, isLoading: false, mutate: vi.fn() }),
  useAccounts: () => ({ data: [] }),
  useContacts: () => ({ data: [{ id: 3, name: "Jane Doe", phone: "", account: null }] }),
  useAddOnProducts: () => ({ data: [] }),
  useVenues: () => ({ data: [] }),
  useSiteSettings: () => ({ data: { currency_symbol: "$", currency_code: "USD", date_format: "DD/MM/YYYY", price_rounding_step: "50", default_tax_rate: "0.2000", service_charge_default_pct: "0", service_charge_taxable_default: true, gratuity_default_pct: "0.00" } }),
  useDateFormat: () => "DD/MM/YYYY",
  useFormatDateTime: () => (v: string | null) => v ?? "-",
  useEventTypes: () => ({ data: [{ id: 1, value: "wedding", label: "Wedding" }] }),
  useServiceStyles: () => ({ data: [] }),
  useMealTypes: () => ({ data: [] }),
  // The page renders CoursesEditor (REL-417), which reads the dish catalogue.
  useDishes: () => ({ data: [] }),
  // The org's Timeline Steps double as its standard-day template.
  useTimelinePresets: () => ({ data: [
    { id: 1, value: "cocktail_hour", label: "Cocktail hour", in_standard_day: true, standard_day_offset_minutes: -75 },
    { id: 2, value: "dinner_service", label: "Dinner service", in_standard_day: true, standard_day_offset_minutes: 0 },
  ] }),
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

// The form requires a customer (the searchable picker replaced a <select required>),
// so every create test has to pick one before it can submit.
const pickCustomer = () => {
  fireEvent.click(screen.getByLabelText("Customer"));
  fireEvent.click(screen.getByText("Jane Doe"));
};

describe("Quote form — the run-of-show reaches the payload", () => {
  beforeEach(() => {
    h.createQuote.mockClear();
    h.updateQuote.mockClear();
    h.id = "new";
  });

  it("CREATE: the prefilled day reaches the payload, edits and all", async () => {
    render(<QuotePage />);

    fireEvent.change(screen.getByLabelText("Guest Count"), { target: { value: "40" } });
    // One click lays out the standard day from this org's presets (here just
    // cocktail hour + dinner service), anchored on the meal time above.
    // The day is built AROUND the meal time, so it has to exist first —
    // building with no anchor is now refused rather than defaulted to 18:30.
    fireEvent.change(screen.getByLabelText("Meal Time"), { target: { value: "18:30" } });
    fireEvent.click(screen.getByText("+ Build a run-of-show"));
    expect(await screen.findByLabelText("Step 1 label")).toHaveValue("Cocktail hour");

    // Then the caterer nudges one of them — that edit must survive to the payload.
    fireEvent.change(screen.getByLabelText("Step 1 time"), { target: { value: "17:00" } });

    pickCustomer();
    fireEvent.click(screen.getByText("Create Quote"));

    await waitFor(() => expect(h.createQuote).toHaveBeenCalledTimes(1));
    const payload = h.createQuote.mock.calls[0][0] as Record<string, unknown>;
    expect(payload.timeline_entries).toEqual([
      { time: "17:00:00", label: "Cocktail hour", date: null },
      { time: "18:30:00", label: "Dinner service", date: null },
    ]);
  });

  it("CREATE: no run-of-show ⇒ an empty list, and the meal-time anchor still saves", async () => {
    render(<QuotePage />);

    fireEvent.change(screen.getByLabelText("Guest Count"), { target: { value: "40" } });
    fireEvent.change(screen.getByLabelText("Meal Time"), { target: { value: "10:00" } });
    pickCustomer();
    fireEvent.click(screen.getByText("Create Quote"));

    await waitFor(() => expect(h.createQuote).toHaveBeenCalledTimes(1));
    const payload = h.createQuote.mock.calls[0][0] as Record<string, unknown>;
    expect(payload.timeline_entries).toEqual([]);
    expect(payload.meal_time).toMatch(/T10:00$/);
  });

  it("CREATE: a step added but not yet chosen still reaches the payload", async () => {
    // Regression: "+ Add step" appends a row with no label yet. It must save,
    // not 400 the whole quote on a blank label.
    render(<QuotePage />);

    fireEvent.change(screen.getByLabelText("Guest Count"), { target: { value: "40" } });
    // The day is built AROUND the meal time, so it has to exist first —
    // building with no anchor is now refused rather than defaulted to 18:30.
    fireEvent.change(screen.getByLabelText("Meal Time"), { target: { value: "18:30" } });
    fireEvent.click(screen.getByText("+ Build a run-of-show"));
    fireEvent.click(await screen.findByText("+ Add step"));
    pickCustomer();
    fireEvent.click(screen.getByText("Create Quote"));

    await waitFor(() => expect(h.createQuote).toHaveBeenCalledTimes(1));
    const payload = h.createQuote.mock.calls[0][0] as Record<string, unknown>;
    expect(payload.timeline_entries).toContainEqual({ time: "19:30:00", label: "", date: null });
  });

  // REL-447 — the mirror of the event page's read-only case. Until this landed the
  // quote's Timeline card was `{editing && …}`, so a saved quote showed no
  // run-of-show at all while the quote PDF printed the whole day for the customer.
  it("READ-ONLY: a saved quote shows its run-of-show without clicking Edit", async () => {
    h.id = "7";
    render(<QuotePage />);

    await screen.findByText("Edit Quote"); // loaded, NOT editing
    expect(screen.getByText("Cocktail hour")).toBeInTheDocument();
    expect(screen.getByText("Dinner service")).toBeInTheDocument();
    expect(screen.getByText("17:00")).toBeInTheDocument();
    // Entries replace the four legacy slots, exactly as on the event page.
    expect(screen.queryByText("Setup Time")).not.toBeInTheDocument();
    expect(screen.queryByText("No timeline set.")).not.toBeInTheDocument();
  });

  it("EDIT: existing entries hydrate, and a reorder is what gets saved", async () => {
    h.id = "7";
    render(<QuotePage />);

    fireEvent.click(await screen.findByText("Edit Quote"));

    // Hydrated from the API's "HH:MM:SS" into the editor's "HH:MM".
    expect(await screen.findByLabelText("Step 1 label")).toHaveValue("Cocktail hour");
    expect(screen.getByLabelText("Step 1 time")).toHaveValue("17:00");

    // Reorder over the handle's arrow keys (the mouse drag needs a real
    // browser; the e2e covers that).
    fireEvent.keyDown(screen.getByLabelText(/^Reorder step 2/), { key: "ArrowUp" });
    fireEvent.click(screen.getByText("Save Quote"));

    await waitFor(() => expect(h.updateQuote).toHaveBeenCalledTimes(1));
    const payload = h.updateQuote.mock.calls[0][1] as Record<string, unknown>;
    expect(payload.timeline_entries).toEqual([
      { time: "18:30:00", label: "Dinner service", date: null },
      { time: "17:00:00", label: "Cocktail hour", date: null },
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
