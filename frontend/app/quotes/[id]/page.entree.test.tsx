import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";

// REL-419 AC1/AC2/AC8 — entrée choices are marked on the REAL quote page and must
// reach the save payload. The proposal surface must never ask for a count or a sum:
// the tallies arrive weeks later with the final guarantee, on the event.
const h = vi.hoisted(() => ({
  updateQuote: vi.fn(),
  quote: {
    id: 1, is_b2b: false, account: null, account_name: null, status: "draft", version: 1,
    event_date: "2026-09-01", guest_count: 100, gents: 0, ladies: 0,
    big_eaters: false, big_eaters_percentage: 0,
    setup_time: null, guest_arrival_time: null, meal_time: null, end_time: null,
    event_type: "wedding", meal_type: "", service_style: "plated", booking_date: "",
    venue: null, venue_name: null, venue_address: "",
    price_per_head: "50.00", tax_rate: "0.2000", valid_until: "",
    primary_contact: 3, contact_name: "Jane Doe", contact_email: null, contact_phone: null,
    notes: "", internal_notes: "",
    // A plated menu with an Entrée course — the ON state.
    dishes: [11, 12, 13], based_on_template: null,
    courses: [{ name: "Entrée", sort_order: 0 }],
    dish_courses: { "11": 0, "12": 0 },
    entree_choices: {},
    line_items: [], additional_meals: [], timeline_entries: [],
    subtotal: "5000.00", tax_amount: "1000.00", total: "6000.00",
    food_total: "5000.00", is_editable: true, event_id: null,
    created_at: "", updated_at: "",
  },
}));

vi.mock("next/navigation", () => ({
  useParams: () => ({ id: "1" }),
  useRouter: () => ({ push: vi.fn() }),
}));

vi.mock("@/components/MenuBuilder", () => ({ default: () => null }));

vi.mock("@/lib/hooks", () => ({
  useQuote: () => ({ data: h.quote, error: null, isLoading: false, mutate: vi.fn() }),
  useAccounts: () => ({ data: [] }),
  useContacts: () => ({ data: [{ id: 3, name: "Jane Doe", phone: "", account: null }] }),
  useAddOnProducts: () => ({ data: [] }),
  useVenues: () => ({ data: [] }),
  useSiteSettings: () => ({ data: { currency_symbol: "£", currency_code: "GBP", date_format: "DD/MM/YYYY", price_rounding_step: "50" } }),
  useDateFormat: () => "DD/MM/YYYY",
  useFormatDateTime: () => (v: string | null) => v ?? "-",
  useEventTypes: () => ({ data: [{ id: 1, value: "wedding", label: "Wedding" }] }),
  useServiceStyles: () => ({ data: [{ id: 1, value: "plated", label: "Plated" }, { id: 2, value: "buffet", label: "Buffet" }] }),
  useDishes: () => ({ data: [{ id: 11, name: "Beef" }, { id: 12, name: "Salmon" }, { id: 13, name: "Cake" }] }),
  useMealTypes: () => ({ data: [] }),
  useTimelinePresets: () => ({ data: [] }),
  useAllLeads: () => ({ data: [] }),
  useProductLines: () => ({ data: [] }),
  useUsers: () => ({ data: [] }),
  revalidate: vi.fn(),
}));

vi.mock("@/lib/auth", () => ({
  useAuth: () => ({ user: { id: 4, first_name: "Olivia", last_name: "Owner", role: "owner" } }),
}));

vi.mock("@/lib/api", () => ({
  api: {
    updateQuote: (...args: unknown[]) => { h.updateQuote(...args); return Promise.resolve(h.quote); },
    getAccount: () => Promise.resolve({ contacts: [] }),
  },
}));

import QuoteDetailPage from "./page";

async function saveAfter(drive: () => void | Promise<void>) {
  render(<QuoteDetailPage />);
  fireEvent.click(screen.getByText("Edit Quote"));
  await drive();
  fireEvent.click(await screen.findByText("Save Quote"));
  await waitFor(() => expect(h.updateQuote).toHaveBeenCalledTimes(1));
  return h.updateQuote.mock.calls[0][1] as Record<string, unknown>;
}

describe("Quote — offering entrée choices at proposal", () => {
  beforeEach(() => {
    h.updateQuote.mockClear();
    h.quote.service_style = "plated";
    h.quote.entree_choices = {};
  });

  it("sends two offered dishes with null counts, and nothing else changes", async () => {  // AC1, AC2
    const payload = await saveAfter(async () => {
      fireEvent.click(await screen.findByLabelText("Offer Beef as a choice"));
      fireEvent.click(await screen.findByLabelText("Offer Salmon as a choice"));
    });
    expect(payload.entree_choices).toEqual({ "11": null, "12": null });
    // The offering is orthogonal to price and to courses.
    expect(payload.price_per_head).toBe("50.00");
    expect(payload.dish_courses).toEqual({ "11": 0, "12": 0 });
  });

  it("never shows a count field or a sum validation at quote time", async () => {  // AC1, AC8
    render(<QuoteDetailPage />);
    fireEvent.click(screen.getByText("Edit Quote"));
    fireEvent.click(await screen.findByLabelText("Offer Beef as a choice"));
    // 100 guests, one offering: no sum check anywhere, no tally input, save works.
    expect(screen.queryByLabelText(/Tally for/)).not.toBeInTheDocument();
    expect(screen.queryByText(/add up to the final guarantee/)).not.toBeInTheDocument();
    fireEvent.click(await screen.findByText("Save Quote"));
    await waitFor(() => expect(h.updateQuote).toHaveBeenCalledTimes(1));
  });

  it("keeps already-offered choices on a save that never touched them", async () => {
    h.quote.entree_choices = { "11": null, "12": null };
    const payload = await saveAfter(() => {});
    expect(payload.entree_choices).toEqual({ "11": null, "12": null });
  });

  it("un-ticking the last offering clears it on the server", async () => {
    h.quote.entree_choices = { "11": null };
    const payload = await saveAfter(async () => {
      fireEvent.click(await screen.findByLabelText("Offer Beef as a choice"));
    });
    // Sent as an explicit empty map — omitting the key would leave the flag set.
    expect(payload.entree_choices).toEqual({});
  });

  it("offers no choice checkbox when the service style is not plated", async () => {  // AC1
    h.quote.service_style = "buffet";
    render(<QuoteDetailPage />);
    fireEvent.click(screen.getByText("Edit Quote"));
    expect(await screen.findByLabelText("Course for Beef")).toBeInTheDocument();  // courses still work
    expect(screen.queryByLabelText("Offer Beef as a choice")).not.toBeInTheDocument();
  });
});
