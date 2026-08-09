import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";

// REL-430 AC1/AC2 on the QUOTE form, create AND edit: the Timeline card sits BELOW
// Guests, the main meal and Additional Meals. The run-of-show is laid out around the
// meal times, so building the day before you've said what's being served meant
// building it twice. A separate file from page.timeline.test.tsx on purpose — AC3
// says every existing test passes unmodified, and this keeps that claim literal.
const h = vi.hoisted(() => ({ push: vi.fn(), id: "new" }));

vi.mock("next/navigation", () => ({
  useParams: () => ({ id: h.id }),
  useRouter: () => ({ push: h.push }),
}));

// MenuBuilder is stubbed, but the "Menu & Pricing" card heading lives on the page
// itself — which is the thing whose position we're pinning.
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
  timeline_entries: [{ id: 11, time: "17:00:00", label: "Cocktail hour", sort_order: 0 }],
  is_taxable: true, subtotal: "1000.00", tax_rate: "0.2000", tax_amount: "200.00", total: "1200.00",
  service_charge_pct: "0", service_charge_taxable: true, service_charge: "0.00",
  gratuity_pct: "0", gratuity: "0.00",
  dishes: [], dish_names: [], based_on_template: null,
  // A real additional meal, so the Additional Meals card renders in read-only too
  // rather than the test passing because the card simply isn't there.
  additional_meals: [{ id: 3, meal_type: "", label: "Brunch", date: null, time: null,
    guest_count: 20, price_per_head: "10.00", audience: "custom", audience_segment: null, sort_order: 0 }],
  courses: [], dish_courses: {},
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
  useDishes: () => ({ data: [] }),
  useTimelinePresets: () => ({ data: [] }),
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
    createQuote: () => Promise.resolve({ id: 99 }),
    updateQuote: () => Promise.resolve({ id: 7 }),
    getAccount: () => Promise.resolve({ contacts: [] }),
  },
}));

import QuotePage from "./page";

/** The form's section headings, in the order they appear in the document. Reading
 * position off the real DOM (not off the source) is what makes this fail if the
 * cards are ever reordered back. */
function sectionOrder() {
  return screen.getAllByRole("heading", { level: 2 }).map((el) => el.textContent?.trim() ?? "");
}

/** Assert `earlier` appears before `later`, with both actually present — a missing
 * heading would otherwise silently pass as -1 < n. */
function expectOrder(order: string[], earlier: string, later: string) {
  expect(order).toContain(earlier);
  expect(order).toContain(later);
  expect(order.indexOf(earlier)).toBeLessThan(order.indexOf(later));
}

describe("Quote form — Timeline sits below the meals (REL-430)", () => {
  beforeEach(() => {
    h.id = "new";
  });

  it("CREATE: order is Guests → Menu & Pricing → Additional Meals → Timeline", () => {
    render(<QuotePage />);

    const order = sectionOrder();
    expectOrder(order, "Guests", "Menu & Pricing");
    expectOrder(order, "Menu & Pricing", "Additional Meals");
    expectOrder(order, "Additional Meals", "Timeline");
    // And it stays above the money, so the form still ends on the total.
    expectOrder(order, "Timeline", "Additional Items");
  });

  it("EDIT: the same order as create (AC2 mirror)", async () => {
    h.id = "7";
    render(<QuotePage />);

    fireEvent.click(await screen.findByText("Edit Quote"));

    const order = sectionOrder();
    expectOrder(order, "Guests", "Menu & Pricing");
    expectOrder(order, "Menu & Pricing", "Additional Meals");
    expectOrder(order, "Additional Meals", "Timeline");
  });

  it("READ-ONLY: a saved quote still reads meals-then-timeline", async () => {
    h.id = "7";
    render(<QuotePage />);

    await screen.findByText("Edit Quote"); // page loaded, not editing
    const order = sectionOrder();
    expectOrder(order, "Menu", "Additional Meals");
    // NOT a decision — this DOCUMENTS a known gap. The quote page has only ever had
    // an edit-mode Timeline card, while the event page renders a read-only one, and
    // the quote PDF *does* print the run-of-show (bookings/pdf.py). So a caterer
    // can't see on screen what the customer receives. Out of scope for REL-430,
    // which is a pure reorder; raised separately. Delete this line when that lands.
    expect(order).not.toContain("Timeline");
  });
});
