import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor, within } from "@testing-library/react";

// REL-454 AC13, the EVENT mirror of app/quotes/[id]/page.addons.test.tsx: the add-ons
// card is one shared component, but each page wires it up itself — so "the quote is
// fine" proves nothing about the event. Drives the real event page and asserts the
// `line_items` reaching api.updateEvent.
const h = vi.hoisted(() => ({ updateEvent: vi.fn(), push: vi.fn() }));

vi.mock("next/navigation", () => ({
  useParams: () => ({ id: "8" }),
  useRouter: () => ({ push: h.push }),
  useSearchParams: () => ({ get: () => null }),
}));

vi.mock("@/components/DealWonDialog", () => ({ default: () => null }));
vi.mock("@/components/MenuBuilder", () => ({ default: () => null }));
vi.mock("@/lib/auth", () => ({
  useAuth: () => ({ user: { id: 7, first_name: "Sam", last_name: "Sales", role: "salesperson" } }),
}));
vi.mock("@/components/CustomerSelect", () => ({
  default: ({ onChange }: { onChange: (v: string) => void }) => (
    <button type="button" onClick={() => onChange("3")}>select-customer</button>
  ),
}));

const addOnProducts = [
  {
    id: 1, name: "Soft Drinks", category: "beverage", default_unit: "each",
    unit_price: "0.00", is_taxable: true, is_featured: true, is_active: true, sort_order: 0,
    variants: [
      { id: 11, name: "1.5L", unit_price: "150.00", is_active: true, sort_order: 0 },
      { id: 12, name: "Tins", unit_price: "80.00", is_active: true, sort_order: 1 },
    ],
  },
  {
    id: 3, name: "Coffee & Tea Service", category: "beverage", default_unit: "per_guest",
    unit_price: "6.00", is_taxable: true, is_featured: false, is_active: true, sort_order: 1,
    variants: [],
  },
];

// 120 guests and a saved per-guest line: the ON state for the one piece of money the
// redesign was forbidden to touch.
const existingEvent = {
  id: 8, name: "Khan Wedding", date: "2026-09-01", event_date: "2026-09-01",
  is_b2b: false, account: null, account_name: null,
  primary_contact: 3, contact_name: "Jane Doe", contact_phone: "",
  venue: null, venue_name: null, venue_address: "", venue_city: "", venue_state: "", venue_zip: "",
  product: 5, product_name: "Catering", assigned_to: 7, assigned_to_name: "Sam Sales",
  created_by: 7, created_by_name: "Sam Sales",
  event_type: "wedding", meal_type: "", service_style: "buffet", booking_date: "",
  price_per_head: "40.00", status: "tentative", status_display: "Tentative",
  is_taxable: false, tax_rate: "0.0000", subtotal: "5520.00", tax_amount: "0.00", total: "5520.00",
  service_charge_pct: "0", service_charge_taxable: true, service_charge: "0.00",
  gratuity_pct: "0", gratuity: "0.00",
  guest_count: 120, gents: 0, ladies: 0, guest_counts: [],
  big_eaters: false, big_eaters_percentage: 0,
  setup_time: null, guest_arrival_time: null, meal_time: null, end_time: null,
  timeline_entries: [],
  guaranteed_count: null, final_count: null, final_count_due: null,
  notes: "", kitchen_instructions: "", banquet_instructions: "", setup_instructions: "",
  dishes: [], dish_comments: [], additional_meals: [],
  line_items: [
    {
      id: 71, variant: null, category: "beverage", description: "Coffee & Tea Service",
      quantity: "1", unit: "per_guest", unit_price: "6.00", line_total: "720.00", sort_order: 0,
    },
  ],
  courses: [], dish_courses: {}, menu_choices: {}, finals_status: null,
  based_on_template: null, constraint_override: null,
  shifts: [], equipment_reservations: [], invoices: [], payments: [],
  amount_paid: "0.00", balance_due: "5520.00", payment_status: "unpaid",
  public_token: null, signature: null, source_quote_id: null, created_at: "",
};

vi.mock("@/lib/hooks", () => ({
  // REL-445: the quote/event pages read their client-message ledger and
  // channel availability from these; unmocked they blow up the whole page.
  useClientMessages: () => ({ data: [], isLoading: false, mutate: vi.fn() }),
  useMessagingStatus: () => ({ data: undefined }),
  useEvent: () => ({ data: existingEvent, error: null, isLoading: false, mutate: vi.fn() }),
  useAccounts: () => ({ data: [] }),
  useContacts: () => ({ data: [{ id: 3, name: "Jane Doe", phone: "", account: null }] }),
  useVenues: () => ({ data: [] }),
  useAddOnProducts: () => ({ data: addOnProducts }),
  useLaborRoles: () => ({ data: [] }),
  useStaff: () => ({ data: [] }),
  useUsers: () => ({ data: [] }),
  useSiteSettings: () => ({ data: { currency_symbol: "$", currency_code: "USD", date_format: "MM/DD/YYYY", price_rounding_step: "50", default_tax_rate: "0.0000", service_charge_default_pct: "0", service_charge_taxable_default: true, gratuity_default_pct: "0.00", guest_segments: [] } }),
  useDateFormat: () => "MM/DD/YYYY",
  useFormatDateTime: () => (v: string | null) => v ?? "-",
  useEventTypes: () => ({ data: [{ id: 1, value: "wedding", label: "Wedding" }] }),
  useServiceStyles: () => ({ data: [] }),
  useDishes: () => ({ data: [] }),
  useCategories: () => ({ data: [] }),
  useMenus: () => ({ data: [], isLoading: false }),
  useMealTypes: () => ({ data: [] }),
  useTimelinePresets: () => ({ data: [] }),
  useProductLines: () => ({ data: [{ id: 5, name: "Catering", is_active: true, colour: "#000", round_robin_index: 0 }] }),
}));

vi.mock("@/lib/api", () => ({
  api: {
    updateEvent: (...args: unknown[]) => { h.updateEvent(...args); return Promise.resolve({ id: 8 }); },
    priceEstimate: () => Promise.resolve({ price_per_head: 50, has_unpriced: false }),
    menuPriceCheck: () => Promise.resolve({ adjusted_price: 50, tier_label: "", breakdown: [], total_adjustment: 0 }),
    getMenu: () => Promise.resolve({ portions: [], courses: [], dish_courses: {}, price_tiers: [] }),
  },
  collectErrorMessages: () => [],
}));

import EventDetailPage from "./page";

const startEditing = async () => {
  render(<EventDetailPage />);
  fireEvent.click(await screen.findByText("Edit"));
};
const save = async () => {
  fireEvent.click(await screen.findByText("Save"));
  await waitFor(() => expect(h.updateEvent).toHaveBeenCalledTimes(1));
  return h.updateEvent.mock.calls[0][1] as Record<string, unknown>;
};
const picker = () => screen.getByTestId("addon-picker");
// Each row names itself, so its controls carry short generic labels.
const line = (i: number) => within(screen.getByTestId(`addon-line-${i}`));

describe("Event edit — add-ons reach the payload in today's shape", () => {
  beforeEach(() => { h.updateEvent.mockClear(); h.push.mockClear(); });

  it("hydrates the saved per-guest line, prices it by guest count, re-saves with its id", async () => {
    await startEditing();
    await screen.findByTestId("addon-line-0");
    expect(line(0).getByLabelText("Edit name")).toHaveTextContent("Coffee & Tea Service");
    expect(line(0).getByLabelText("Edit price, unit and category")).toHaveTextContent("$6.00 per guest × 120 guests");
    // 120 guests × $6 — the stored quantity of 1 is not what this line costs (AC3).
    expect(line(0).getByText("$720.00")).toBeInTheDocument();

    const payload = await save();
    expect(payload.line_items).toEqual([
      { id: 71, variant: null, category: "beverage", description: "Coffee & Tea Service", quantity: "1", unit: "per_guest", unit_price: "6.00", sort_order: 0 },
    ]);
  });

  it("adds a catalogue variant and a custom line, and both save in the old shape", async () => {
    await startEditing();
    fireEvent.click(screen.getByText("+ Add item"));
    fireEvent.click(within(picker()).getByLabelText("Add Soft Drinks — Tins"));
    fireEvent.click(within(picker()).getByText("Cancel"));

    fireEvent.click(line(1).getByLabelText("Increase quantity"));
    fireEvent.click(screen.getByText("Custom item"));
    fireEvent.change(line(2).getByLabelText("Name"), { target: { value: "Coat check" } });
    fireEvent.click(line(2).getByLabelText("Edit price, unit and category"));
    fireEvent.change(line(2).getByLabelText("Unit price"), { target: { value: "100" } });

    const payload = await save();
    expect(payload.line_items).toEqual([
      { id: 71, variant: null, category: "beverage", description: "Coffee & Tea Service", quantity: "1", unit: "per_guest", unit_price: "6.00", sort_order: 0 },
      { variant: 12, category: "beverage", description: "Soft Drinks — Tins", quantity: "2", unit: "each", unit_price: "80.00", sort_order: 0 },
      { variant: null, category: "fee", description: "Coat check", quantity: "1", unit: "each", unit_price: "100", sort_order: 0 },
    ]);
    for (const li of payload.line_items as Record<string, unknown>[]) {
      expect(li).not.toHaveProperty("is_taxable");
    }
  });

  it("a price typed over the catalogue's reaches the payload", async () => {
    await startEditing();
    await screen.findByTestId("addon-line-0");
    fireEvent.click(line(0).getByLabelText("Edit price, unit and category"));
    fireEvent.change(line(0).getByLabelText("Unit price"), { target: { value: "8" } });
    expect(line(0).getByText("$960.00")).toBeInTheDocument();

    const payload = await save();
    expect((payload.line_items as Record<string, unknown>[])[0].unit_price).toBe("8");
  });

  it("removing the line sends an empty list", async () => {
    await startEditing();
    await screen.findByTestId("addon-line-0");
    fireEvent.click(line(0).getByLabelText("Remove"));
    const payload = await save();
    expect(payload.line_items).toEqual([]);
  });
});

describe("Event view — the saved line renders a real multiplication sign", () => {
  // A × escape in JSX *text* renders as the six literal characters, not ×
  // (escapes only resolve inside JS strings), so every view-mode line read
  // "×1.00 @ $6.00". A screenshot-level bug no payload test can see.
  it("shows ×quantity, not a literal \\u00d7", async () => {
    render(<EventDetailPage />);
    await screen.findByText("Coffee & Tea Service");
    expect(document.body.textContent).toContain("×1");
    expect(document.body.textContent).not.toContain("\\u00d7");
  });
});
