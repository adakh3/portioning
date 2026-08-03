import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";

// REL-451 AC1/AC5/AC8/AC10 — the menu is ONE card now, so the choice is marked on a
// dish row inside its course rather than in a separate Menu-choices card. These drive
// the REAL MenuBuilder on the REAL quote page (it is no longer mocked away — the thing
// under test lives inside it) and assert what reaches `updateQuote`.
//
// Still true from REL-419: the proposal surface never asks for a count or a sum. The
// tallies arrive weeks later with the final guarantee, on the event.
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
    // A plated menu with an Entrée course + one un-coursed dish — the ON state.
    dishes: [11, 12, 13], based_on_template: null,
    courses: [{ name: "Entrée", sort_order: 0 }],
    dish_courses: { "11": 0, "12": 0 },
    menu_choices: {},
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
  useDishes: () => ({ data: [
    { id: 11, name: "Beef", category: 1, dietary_tags: [] },
    { id: 12, name: "Salmon", category: 1, dietary_tags: [] },
    { id: 13, name: "Cake", category: 2, dietary_tags: [] },
  ] }),
  // The one card owns the dish picker, so it needs the catalogue's categories too.
  useCategories: () => ({ data: [{ id: 1, name: "Mains" }, { id: 2, name: "Desserts" }] }),
  useMenus: () => ({ data: [], isLoading: false }),
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
    // The card debounces a suggested rate when it has dishes + a guest count.
    priceEstimate: () => Promise.resolve({ price_per_head: 50, has_unpriced: false }),
    menuPriceCheck: () => Promise.resolve({ adjusted_price: 50, tier_label: "", breakdown: [], total_adjustment: 0 }),
    getMenu: () => Promise.resolve({ portions: [], courses: [], dish_courses: {}, price_tiers: [] }),
  },
  collectErrorMessages: () => [],
}));

import QuoteDetailPage from "./page";

const chip = (dish: string) => `Mark ${dish} as a guest choice`;
const unchip = (dish: string) => `Remove ${dish} as a guest choice`;

async function saveAfter(drive: () => void | Promise<void>) {
  render(<QuoteDetailPage />);
  fireEvent.click(screen.getByText("Edit Quote"));
  await drive();
  fireEvent.click(await screen.findByText("Save Quote"));
  await waitFor(() => expect(h.updateQuote).toHaveBeenCalledTimes(1));
  return h.updateQuote.mock.calls[0][1] as Record<string, unknown>;
}

describe("Quote — the one Menu card at proposal", () => {
  beforeEach(() => {
    h.updateQuote.mockClear();
    h.quote.service_style = "plated";
    h.quote.menu_choices = {};
    h.quote.courses = [{ name: "Entrée", sort_order: 0 }];
    h.quote.dish_courses = { "11": 0, "12": 0 };
  });

  it("is one card — the old Courses and Menu-choices cards are gone", async () => {  // AC1
    render(<QuoteDetailPage />);
    fireEvent.click(screen.getByText("Edit Quote"));
    expect(await screen.findByTestId("menu-structure")).toBeInTheDocument();
    // The "Assign dishes" dropdown per dish and the Offered tick are both retired.
    expect(screen.queryByLabelText("Course for Beef")).not.toBeInTheDocument();
    expect(screen.queryByLabelText("Offer Beef as a choice")).not.toBeInTheDocument();
    // Exactly one row per dish on the whole page (AC3).
    expect(screen.getAllByLabelText("Remove Beef")).toHaveLength(1);
  });

  it("sends two offered dishes with null counts, and nothing else changes", async () => {  // AC5, AC10
    const payload = await saveAfter(async () => {
      fireEvent.click(await screen.findByLabelText(chip("Beef")));
      fireEvent.click(await screen.findByLabelText(chip("Salmon")));
    });
    expect(payload.menu_choices).toEqual({ "11": null, "12": null });
    // The offering is orthogonal to price and to courses.
    expect(payload.price_per_head).toBe("50.00");
    expect(payload.dish_courses).toEqual({ "11": 0, "12": 0 });
    expect(payload.dish_ids).toEqual([11, 12, 13]);
  });

  it("never shows a count field or a sum validation at quote time", async () => {  // AC7
    render(<QuoteDetailPage />);
    fireEvent.click(screen.getByText("Edit Quote"));
    fireEvent.click(await screen.findByLabelText(chip("Beef")));
    // One offering warns, but never blocks: 100 guests, no tally input, save works.
    expect(await screen.findByText("a choice needs two options")).toBeInTheDocument();
    expect(screen.queryByLabelText(/Tally for/)).not.toBeInTheDocument();
    expect(screen.queryByText(/add up to the final guarantee/)).not.toBeInTheDocument();
    fireEvent.click(await screen.findByText("Save Quote"));
    await waitFor(() => expect(h.updateQuote).toHaveBeenCalledTimes(1));
  });

  it("clears the warning once a second option is marked", async () => {  // AC7
    render(<QuoteDetailPage />);
    fireEvent.click(screen.getByText("Edit Quote"));
    fireEvent.click(await screen.findByLabelText(chip("Beef")));
    expect(await screen.findByText("a choice needs two options")).toBeInTheDocument();
    fireEvent.click(await screen.findByLabelText(chip("Salmon")));
    await waitFor(() =>
      expect(screen.queryByText("a choice needs two options")).not.toBeInTheDocument());
  });

  it("keeps already-offered choices on a save that never touched them", async () => {  // AC10
    h.quote.menu_choices = { "11": null, "12": null };
    const payload = await saveAfter(() => {});
    expect(payload.menu_choices).toEqual({ "11": null, "12": null });
  });

  it("un-ticking the last offering clears it on the server", async () => {  // AC5, AC10
    h.quote.menu_choices = { "11": null };
    const payload = await saveAfter(async () => {
      fireEvent.click(await screen.findByLabelText(unchip("Beef")));
    });
    // Sent as an explicit empty map — omitting the key would leave the flag set.
    expect(payload.menu_choices).toEqual({});
  });


  it("shows no choice affordance when the service style is not plated", async () => {  // AC8
    h.quote.service_style = "buffet";
    render(<QuoteDetailPage />);
    fireEvent.click(screen.getByText("Edit Quote"));
    // Courses still render on a buffet — only the choice affordances are plated-only.
    expect(await screen.findByLabelText("Course 1 name")).toBeInTheDocument();
    expect(screen.queryByLabelText(chip("Beef"))).not.toBeInTheDocument();
    expect(screen.queryByText("guests choose")).not.toBeInTheDocument();
  });

  it("preserves existing flags silently on a non-plated booking", async () => {  // AC8
    h.quote.service_style = "buffet";
    h.quote.menu_choices = { "11": null, "12": null };
    const payload = await saveAfter(() => {});
    // Not rendered, not editable — but never destroyed by a save.
    expect(payload.menu_choices).toEqual({ "11": null, "12": null });
  });

  it("renders a course-less booking as a flat list", async () => {  // AC8, AC12
    h.quote.courses = [];
    h.quote.dish_courses = {};
    render(<QuoteDetailPage />);
    fireEvent.click(screen.getByText("Edit Quote"));
    expect(await screen.findByText("+ Add course")).toBeInTheDocument();
    // No headers, no "On the table" scaffolding, no choice chips.
    expect(screen.queryByText("On the table")).not.toBeInTheDocument();
    expect(screen.queryByLabelText("Course 1 name")).not.toBeInTheDocument();
    expect(screen.queryByLabelText(chip("Beef"))).not.toBeInTheDocument();
  });
});
