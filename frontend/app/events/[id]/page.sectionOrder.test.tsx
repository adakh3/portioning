import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";

// The EVENT mirror of app/quotes/[id]/page.sectionOrder.test.tsx (REL-430 AC1/AC2).
// The event page owns its own layout — the same card, wired separately — which is
// exactly the asymmetry the mirror rule exists to catch. Unlike the quote, the event
// page renders Guests and Timeline in read-only too, so the order is assertable in
// all three states here.
const h = vi.hoisted(() => ({ push: vi.fn(), id: "new" }));

vi.mock("next/navigation", () => ({
  useParams: () => ({ id: h.id }),
  useRouter: () => ({ push: h.push }),
  useSearchParams: () => ({ get: () => null }),
}));

vi.mock("@/components/MenuBuilder", () => ({ default: () => null }));
vi.mock("@/components/DealWonDialog", () => ({ default: () => null }));
vi.mock("@/lib/auth", () => ({
  useAuth: () => ({ user: { id: 7, first_name: "Sam", last_name: "Sales", role: "owner" } }),
}));
vi.mock("@/components/CustomerSelect", () => ({
  default: ({ onChange }: { onChange: (v: string) => void }) => (
    <button type="button" onClick={() => onChange("3")}>select-customer</button>
  ),
}));

const existingEvent = {
  id: 8, name: "Khan Wedding", date: "2026-09-01", event_date: "2026-09-01",
  is_b2b: false, account: null, account_name: null,
  primary_contact: 3, contact_name: "Jane Doe", contact_phone: "",
  venue: null, venue_name: null, venue_address: "", venue_city: "", venue_state: "", venue_zip: "",
  product: 5, product_name: "Catering", assigned_to: 7, assigned_to_name: "Sam Sales",
  created_by: 7, created_by_name: "Sam Sales",
  event_type: "wedding", meal_type: "", service_style: "", booking_date: "",
  price_per_head: "40.00", status: "tentative", status_display: "Tentative",
  is_taxable: false, tax_rate: "0.0000", subtotal: "2000.00", tax_amount: "0.00", total: "2000.00",
  service_charge_pct: "0", service_charge_taxable: true, service_charge: "0.00",
  gratuity_pct: "0", gratuity: "0.00",
  guest_count: 50, gents: 0, ladies: 0, guest_counts: [],
  big_eaters: false, big_eaters_percentage: 0,
  setup_time: null, guest_arrival_time: null, meal_time: null, end_time: null,
  timeline_entries: [{ id: 21, time: "15:00:00", label: "Staff arrive", sort_order: 0 }],
  guaranteed_count: null, final_count: null, final_count_due: null,
  notes: "", kitchen_instructions: "", banquet_instructions: "", setup_instructions: "",
  dishes: [], dish_comments: [], line_items: [],
  // A real additional meal so the card renders read-only too, rather than the
  // assertion passing because the card simply isn't on the page.
  additional_meals: [{ id: 3, meal_type: "", label: "Brunch", date: null, time: null,
    guest_count: 20, price_per_head: "10.00", audience: "custom", audience_segment: null, sort_order: 0 }],
  courses: [], dish_courses: {},
  based_on_template: null, constraint_override: null,
  shifts: [], equipment_reservations: [], invoices: [], payments: [],
  amount_paid: "0.00", balance_due: "2000.00", payment_status: "unpaid",
  public_token: null, signature: null, source_quote_id: null, created_at: "",
};

vi.mock("@/lib/hooks", () => ({
  useEvent: () => ({ data: h.id === "new" ? null : existingEvent, error: null, isLoading: false, mutate: vi.fn() }),
  useAccounts: () => ({ data: [] }),
  useContacts: () => ({ data: [{ id: 3, name: "Jane Doe", phone: "", account: null }] }),
  useVenues: () => ({ data: [] }),
  useAddOnProducts: () => ({ data: [] }),
  useLaborRoles: () => ({ data: [] }),
  useStaff: () => ({ data: [] }),
  useUsers: () => ({ data: [] }),
  useSiteSettings: () => ({ data: { currency_symbol: "$", currency_code: "USD", date_format: "DD/MM/YYYY", price_rounding_step: "50", default_tax_rate: "0.0000", service_charge_default_pct: "0", service_charge_taxable_default: true, gratuity_default_pct: "0.00", guest_segments: [{ name: "Adults", is_default: true, counts_toward_total: true, price_multiplier: "1.0000", sort_order: 0 }, { name: "Kids", is_default: false, counts_toward_total: true, price_multiplier: "0.5000", sort_order: 1 }] } }),
  useDateFormat: () => "DD/MM/YYYY",
  useFormatDateTime: () => (v: string | null) => v ?? "-",
  useEventTypes: () => ({ data: [{ id: 1, value: "wedding", label: "Wedding" }] }),
  useServiceStyles: () => ({ data: [] }),
  useMealTypes: () => ({ data: [] }),
  useDishes: () => ({ data: [] }),
  useTimelinePresets: () => ({ data: [] }),
  useProductLines: () => ({ data: [{ id: 5, name: "Catering", is_active: true, colour: "#000", round_robin_index: 0 }] }),
}));

vi.mock("@/lib/api", () => ({
  api: {
    createEvent: () => Promise.resolve({ id: 55 }),
    updateEvent: () => Promise.resolve({ id: 8 }),
  },
}));

import EventPage from "./page";

function sectionOrder() {
  return screen.getAllByRole("heading", { level: 2 }).map((el) => el.textContent?.trim() ?? "");
}

function expectOrder(order: string[], earlier: string, later: string) {
  expect(order).toContain(earlier);
  expect(order).toContain(later);
  expect(order.indexOf(earlier)).toBeLessThan(order.indexOf(later));
}

describe("Event form — Timeline sits below the meals (REL-430)", () => {
  beforeEach(() => {
    h.id = "new";
  });

  it("CREATE: order is Guests → Main Meal → Additional Meals → Timeline", () => {
    render(<EventPage />);

    const order = sectionOrder();
    expectOrder(order, "Guests", "Main Meal");
    expectOrder(order, "Main Meal", "Additional Meals");
    expectOrder(order, "Additional Meals", "Timeline");
    expectOrder(order, "Timeline", "Add-on items");
  });

  it("EDIT: the same order as create (AC2 mirror)", async () => {
    h.id = "8";
    render(<EventPage />);

    fireEvent.click(await screen.findByText("Edit"));

    const order = sectionOrder();
    expectOrder(order, "Guests", "Main Meal");
    expectOrder(order, "Main Meal", "Additional Meals");
    expectOrder(order, "Additional Meals", "Timeline");
  });

  it("READ-ONLY: a saved event reads the same way", async () => {
    h.id = "8";
    render(<EventPage />);

    await screen.findByText("Edit"); // loaded, not editing
    const order = sectionOrder();
    expectOrder(order, "Guests", "Main Meal");
    expectOrder(order, "Main Meal", "Additional Meals");
    expectOrder(order, "Additional Meals", "Timeline");
  });
});
