import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor, within } from "@testing-library/react";

// REL-454 AC13 on the QUOTE form, create AND edit: drive the real page's add-ons card
// and assert the `line_items` that reach api.createQuote / api.updateQuote. The card's
// UI changed completely (checkbox wall → chosen lines + picker) while the payload
// must not have moved a millimetre — and the payload is only provable from the page,
// because field → state → payload is where this class of bug hides.
const h = vi.hoisted(() => ({ createQuote: vi.fn(), updateQuote: vi.fn(), push: vi.fn(), id: "new" }));

vi.mock("next/navigation", () => ({
  useParams: () => ({ id: h.id }),
  useRouter: () => ({ push: h.push }),
}));

vi.mock("@/components/MenuBuilder", () => ({ default: () => null }));

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
    id: 2, name: "Delivery & Setup", category: "fee", default_unit: "flat",
    unit_price: "450.00", is_taxable: true, is_featured: false, is_active: true, sort_order: 1,
    variants: [],
  },
];

// An existing quote that ALREADY has a saved add-on line — the ON state. With an
// empty line_items list an edit test would pass even if hydration were broken.
const existingQuote = {
  id: 7, version: 1, status: "draft", status_display: "Draft", is_editable: true,
  lead: null, primary_contact: 3, is_b2b: false, account: null,
  event_date: "2026-09-01", venue: null, venue_address: "",
  venue_city: "", venue_state: "", venue_zip: "",
  product: 5, guest_count: 40, gents: 0, ladies: 0, guest_counts: [],
  big_eaters: false, big_eaters_percentage: 0, price_per_head: "25.00",
  event_type: "wedding", meal_type: "", booking_date: "", service_style: "", valid_until: "",
  setup_time: null, guest_arrival_time: null, meal_time: null, end_time: null,
  timeline_entries: [],
  is_taxable: true, subtotal: "1300.00", tax_rate: "0.2000", tax_amount: "260.00", total: "1560.00",
  service_charge_pct: "0", service_charge_taxable: true, service_charge: "0.00",
  gratuity_pct: "0", gratuity: "0.00",
  dishes: [], dish_names: [], based_on_template: null, additional_meals: [],
  notes: "", internal_notes: "", food_total: "1000.00",
  line_items: [
    {
      id: 55, variant: 11, category: "beverage", description: "Soft Drinks · 1.5L",
      quantity: "2", unit: "each", unit_price: "150.00", line_total: "300.00", sort_order: 0,
    },
  ],
  created_at: "", updated_at: "", sent_at: null, accepted_at: null,
  public_token: null, signature: null, event: null, created_by: null, assigned_to: null,
};

vi.mock("@/lib/hooks", () => ({
  useQuote: () => ({ data: h.id === "new" ? null : existingQuote, error: null, isLoading: false, mutate: vi.fn() }),
  useAccounts: () => ({ data: [] }),
  useContacts: () => ({ data: [{ id: 3, name: "Jane Doe", phone: "", account: null }] }),
  useAddOnProducts: () => ({ data: addOnProducts }),
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
    createQuote: (...args: unknown[]) => { h.createQuote(...args); return Promise.resolve({ id: 99 }); },
    updateQuote: (...args: unknown[]) => { h.updateQuote(...args); return Promise.resolve({ id: 7 }); },
    getAccount: () => Promise.resolve({ contacts: [] }),
  },
}));

import QuotePage from "./page";

const pickCustomer = () => {
  fireEvent.click(screen.getByLabelText("Customer"));
  fireEvent.click(screen.getByText("Jane Doe"));
};
const picker = () => screen.getByTestId("addon-picker");

describe("Quote form — add-ons reach the payload in today's shape", () => {
  beforeEach(() => {
    h.createQuote.mockClear();
    h.updateQuote.mockClear();
    h.id = "new";
  });

  it("CREATE: a picked variant and a custom line save with the same fields as before", async () => {
    render(<QuotePage />);
    fireEvent.change(screen.getByLabelText("Guest Count"), { target: { value: "40" } });

    fireEvent.click(screen.getByText("+ Add item"));
    fireEvent.click(within(picker()).getByLabelText("Add Soft Drinks · 1.5L"));
    fireEvent.click(within(picker()).getByLabelText("Add Delivery & Setup"));
    fireEvent.click(screen.getByText("Done")); // the trigger closes it again

    // Quantity via the stepper, price via the click-to-edit subtitle.
    fireEvent.click(screen.getByLabelText("Increase quantity for Soft Drinks · 1.5L"));
    fireEvent.click(screen.getByLabelText("Edit price for Delivery & Setup"));
    fireEvent.change(screen.getByLabelText("Unit price for Delivery & Setup"), { target: { value: "500" } });

    // And an ad-hoc line the catalogue has never heard of.
    fireEvent.click(screen.getByText("Custom item"));
    fireEvent.change(screen.getByLabelText("Description for item 3"), { target: { value: "Coat check" } });
    fireEvent.change(screen.getByLabelText("Category for item 3"), { target: { value: "labor" } });
    fireEvent.change(screen.getByLabelText("Unit price for Coat check"), { target: { value: "100" } });

    pickCustomer();
    fireEvent.click(screen.getByText("Create Quote"));

    await waitFor(() => expect(h.createQuote).toHaveBeenCalledTimes(1));
    const payload = h.createQuote.mock.calls[0][0] as Record<string, unknown>;
    // Exactly the pre-REL-454 shape. Note create posts the editor's objects as they
    // are (it does not go through `buildLineItemsPayload` the way the edit save does),
    // so there is no `sort_order` here — unchanged by this work, and pinned so a
    // future tidy-up of that asymmetry is a deliberate decision rather than a slip.
    expect(payload.line_items).toEqual([
      { variant: 11, category: "beverage", description: "Soft Drinks · 1.5L", quantity: "2", unit: "each", unit_price: "150.00" },
      { variant: null, category: "fee", description: "Delivery & Setup", quantity: "1", unit: "flat", unit_price: "500" },
      { variant: null, category: "labor", description: "Coat check", quantity: "1", unit: "each", unit_price: "100" },
    ]);
    for (const li of payload.line_items as Record<string, unknown>[]) {
      expect(li).not.toHaveProperty("id");
      expect(li).not.toHaveProperty("is_taxable");
    }
  });

  it("CREATE: no add-ons ⇒ an empty list, not a missing key", async () => {
    render(<QuotePage />);
    fireEvent.change(screen.getByLabelText("Guest Count"), { target: { value: "40" } });
    pickCustomer();
    fireEvent.click(screen.getByText("Create Quote"));

    await waitFor(() => expect(h.createQuote).toHaveBeenCalledTimes(1));
    expect((h.createQuote.mock.calls[0][0] as Record<string, unknown>).line_items).toEqual([]);
  });

  it("EDIT: an existing line hydrates into the card and re-saves WITH its id", async () => {
    h.id = "7";
    render(<QuotePage />);
    fireEvent.click(await screen.findByText("Edit Quote"));

    // It reads as a chosen line, priced, not as a ticked catalogue checkbox.
    const row = await screen.findByTestId("addon-line-0");
    expect(within(row).getByText("Soft Drinks · 1.5L")).toBeInTheDocument();
    expect(within(row).getByLabelText("Edit price for Soft Drinks · 1.5L")).toHaveTextContent("$150.00 each");
    expect(within(row).getByText("$300.00")).toBeInTheDocument();

    fireEvent.click(screen.getByText("Save Quote"));
    await waitFor(() => expect(h.updateQuote).toHaveBeenCalledTimes(1));
    const payload = h.updateQuote.mock.calls[0][1] as Record<string, unknown>;
    // The id is what lets the backend reconcile instead of recreating the row.
    expect(payload.line_items).toEqual([
      { id: 55, variant: 11, category: "beverage", description: "Soft Drinks · 1.5L", quantity: "2", unit: "each", unit_price: "150.00", sort_order: 0 },
    ]);
  });

  it("EDIT: the picker greys what's already on the quote, and adds its sibling", async () => {
    h.id = "7";
    render(<QuotePage />);
    fireEvent.click(await screen.findByText("Edit Quote"));
    fireEvent.click(screen.getByText("+ Add item"));

    expect(within(picker()).getByLabelText("Soft Drinks · 1.5L — already on quote")).toBeDisabled();
    fireEvent.click(within(picker()).getByLabelText("Add Soft Drinks · Tins"));

    fireEvent.click(screen.getByText("Save Quote"));
    await waitFor(() => expect(h.updateQuote).toHaveBeenCalledTimes(1));
    const payload = h.updateQuote.mock.calls[0][1] as Record<string, unknown>;
    expect(payload.line_items).toEqual([
      { id: 55, variant: 11, category: "beverage", description: "Soft Drinks · 1.5L", quantity: "2", unit: "each", unit_price: "150.00", sort_order: 0 },
      { variant: 12, category: "beverage", description: "Soft Drinks · Tins", quantity: "1", unit: "each", unit_price: "80.00", sort_order: 0 },
    ]);
  });

  it("EDIT: removing the only line sends an empty list, so the save actually clears it", async () => {
    h.id = "7";
    render(<QuotePage />);
    fireEvent.click(await screen.findByText("Edit Quote"));
    fireEvent.click(await screen.findByLabelText("Remove Soft Drinks · 1.5L"));
    fireEvent.click(screen.getByText("Save Quote"));

    await waitFor(() => expect(h.updateQuote).toHaveBeenCalledTimes(1));
    expect((h.updateQuote.mock.calls[0][1] as Record<string, unknown>).line_items).toEqual([]);
  });
});
