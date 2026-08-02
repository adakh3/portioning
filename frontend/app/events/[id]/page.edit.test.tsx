import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";

// The EVENT *edit* page had no page-level test at all — only create and timeline —
// which is exactly how a save could silently wipe the menu of an existing event.
//
// The event save payload always sends `dish_ids: menuData.dish_ids`, but the
// edit-mode MenuBuilder instant-saves through `onSave` instead of `onChange`, so
// `menuData` stayed at its initial `[]` for an already-saved event. Pressing Save
// on the form therefore sent `dish_ids: []` and cleared the menu — and with it the
// course assignments, since a course can only reference dishes on the booking.
//
// The quote page has always hydrated `menuData` when it starts editing; this is the
// missing event mirror of that.
const h = vi.hoisted(() => ({ updateEvent: vi.fn(), push: vi.fn() }));

vi.mock("next/navigation", () => ({
  useParams: () => ({ id: "8" }),
  useRouter: () => ({ push: h.push }),
  useSearchParams: () => ({ get: () => null }),
}));

vi.mock("@/components/MenuBuilder", () => ({ default: () => null }));
vi.mock("@/components/DealWonDialog", () => ({ default: () => null }));
vi.mock("@/lib/auth", () => ({
  useAuth: () => ({ user: { id: 7, first_name: "Sam", last_name: "Sales", role: "salesperson" } }),
}));
vi.mock("@/components/CustomerSelect", () => ({
  default: ({ onChange }: { onChange: (v: string) => void }) => (
    <button type="button" onClick={() => onChange("3")}>select-customer</button>
  ),
}));

// An existing event with a real menu, a template, and two courses with assignments —
// the ON state. A fixture with an empty menu would pass even with the bug.
const existingEvent = {
  id: 8, name: "Khan Wedding", date: "2026-09-01", event_date: "2026-09-01",
  is_b2b: false, account: null, account_name: null,
  primary_contact: 3, contact_name: "Jane Doe", contact_phone: "",
  venue: null, venue_name: null, venue_address: "", venue_city: "", venue_state: "", venue_zip: "",
  product: 5, product_name: "Catering", assigned_to: 7, assigned_to_name: "Sam Sales",
  created_by: 7, created_by_name: "Sam Sales",
  event_type: "wedding", meal_type: "", service_style: "plated", booking_date: "",
  price_per_head: "40.00", status: "tentative", status_display: "Tentative",
  is_taxable: false, tax_rate: "0.0000", subtotal: "2000.00", tax_amount: "0.00", total: "2000.00",
  service_charge_pct: "0", service_charge_taxable: true, service_charge: "0.00",
  gratuity_pct: "0", gratuity: "0.00",
  guest_count: 50, gents: 0, ladies: 0, guest_counts: [],
  big_eaters: false, big_eaters_percentage: 0,
  setup_time: null, guest_arrival_time: null, meal_time: null, end_time: null,
  timeline_entries: [],
  guaranteed_count: null, final_count: null, final_count_due: null,
  notes: "", kitchen_instructions: "", banquet_instructions: "", setup_instructions: "",
  dishes: [11, 12, 13], dish_comments: [], line_items: [], additional_meals: [],
  courses: [{ name: "Starter", sort_order: 0 }, { name: "Main", sort_order: 1 }],
  dish_courses: { "11": 0, "12": 1 },
  // Plated, with two offered entrée choices — one already tallied by the finals
  // panel. The ON state: an empty map would pass even if the save dropped them.
  entree_choices: { "12": 90, "13": null },
  finals_status: null,
  based_on_template: 4, constraint_override: null,
  shifts: [], equipment_reservations: [], invoices: [], payments: [],
  amount_paid: "0.00", balance_due: "2000.00", payment_status: "unpaid",
  public_token: null, signature: null, source_quote_id: null, created_at: "",
};

vi.mock("@/lib/hooks", () => ({
  useEvent: () => ({ data: existingEvent, error: null, isLoading: false, mutate: vi.fn() }),
  useAccounts: () => ({ data: [] }),
  useContacts: () => ({ data: [{ id: 3, name: "Jane Doe", phone: "", account: null }] }),
  useVenues: () => ({ data: [] }),
  useAddOnProducts: () => ({ data: [] }),
  useLaborRoles: () => ({ data: [] }),
  useStaff: () => ({ data: [] }),
  useUsers: () => ({ data: [] }),
  useSiteSettings: () => ({ data: { currency_symbol: "$", currency_code: "USD", date_format: "MM/DD/YYYY", price_rounding_step: "50", default_tax_rate: "0.0000", service_charge_default_pct: "20.00", service_charge_taxable_default: true, gratuity_default_pct: "0.00", guest_segments: [] } }),
  useDateFormat: () => "MM/DD/YYYY",
  useFormatDateTime: () => (v: string | null) => v ?? "-",
  useEventTypes: () => ({ data: [{ id: 1, value: "wedding", label: "Wedding" }] }),
  useServiceStyles: () => ({ data: [] }),
  useDishes: () => ({ data: [{ id: 11, name: "Bruschetta" }, { id: 12, name: "Roast Beef" }, { id: 13, name: "Cheesecake" }] }),
  useMealTypes: () => ({ data: [] }),
  useTimelinePresets: () => ({ data: [] }),
  useProductLines: () => ({ data: [{ id: 5, name: "Catering", is_active: true, colour: "#000", round_robin_index: 0 }] }),
}));

vi.mock("@/lib/api", () => ({
  api: {
    updateEvent: (...args: unknown[]) => { h.updateEvent(...args); return Promise.resolve({ id: 8 }); },
  },
}));

import EventDetailPage from "./page";

async function editAndSave() {
  render(<EventDetailPage />);
  fireEvent.click(await screen.findByText("Edit"));
  fireEvent.click(await screen.findByText("Save"));
  await waitFor(() => expect(h.updateEvent).toHaveBeenCalledTimes(1));
  return h.updateEvent.mock.calls[0][1] as Record<string, unknown>;
}

describe("Event edit — saving the form must not destroy what it never edited", () => {
  beforeEach(() => { h.updateEvent.mockClear(); h.push.mockClear(); });

  it("keeps the existing menu on a save that never touched it", async () => {
    const payload = await editAndSave();
    // The bug sent []; that cleared every dish on the event.
    expect(payload.dish_ids).toEqual([11, 12, 13]);
    expect(payload.based_on_template).toBe(4);
  });

  it("keeps the course assignments, which can only reference dishes on the booking", async () => {
    const payload = await editAndSave();
    expect(payload.courses).toEqual([
      { name: "Starter", sort_order: 0 },
      { name: "Main", sort_order: 1 },
    ]);
    expect(payload.dish_courses).toEqual({ "11": 0, "12": 1 });
  });

  it("keeps the offered entrée choices AND the tallies the finals panel recorded", async () => {  // REL-419
    const payload = await editAndSave();
    // Dropping the counts here would wipe a recorded final breakdown on every
    // ordinary edit of the event form.
    expect(payload.entree_choices).toEqual({ "12": 90, "13": null });
  });

  it("marking another dish as an entrée choice keeps the existing tally intact", async () => {  // REL-419
    render(<EventDetailPage />);
    fireEvent.click(await screen.findByText("Edit"));
    fireEvent.click(await screen.findByLabelText("Offer Bruschetta as a choice"));
    fireEvent.click(await screen.findByText("Save"));
    await waitFor(() => expect(h.updateEvent).toHaveBeenCalledTimes(1));
    const payload = h.updateEvent.mock.calls[0][1] as Record<string, unknown>;
    expect(payload.entree_choices).toEqual({ "11": null, "12": 90, "13": null });
  });

  it("offers the dish→course dropdowns, which need the booking's dishes in edit mode", async () => {
    render(<EventDetailPage />);
    fireEvent.click(await screen.findByText("Edit"));
    // Empty menu state meant CoursesEditor had nothing assignable and rendered none.
    expect(await screen.findByLabelText("Course for Bruschetta")).toBeTruthy();
    expect(await screen.findByLabelText("Course for Roast Beef")).toBeTruthy();
  });
});
