import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor, within } from "@testing-library/react";

// The EVENT mirror of app/quotes/[id]/page.timeline.test.tsx (REL-418 AC7).
// Same shared component, but the event page owns its own state wiring — which is
// exactly the asymmetry the mirror rule exists to catch.
const h = vi.hoisted(() => ({ createEvent: vi.fn(), updateEvent: vi.fn(), push: vi.fn(), id: "new" }));

vi.mock("next/navigation", () => ({
  useParams: () => ({ id: h.id }),
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
  timeline_entries: [
    { id: 21, time: "15:00:00", label: "Staff arrive", sort_order: 0 },
    { id: 22, time: "21:00:00", label: "Cake cutting", sort_order: 1 },
  ],
  guaranteed_count: null, final_count: null, final_count_due: null,
  notes: "", kitchen_instructions: "", banquet_instructions: "", setup_instructions: "",
  dishes: [], dish_comments: [], line_items: [], additional_meals: [],
  based_on_template: null, constraint_override: null,
  shifts: [], equipment_reservations: [], invoices: [], payments: [],
  amount_paid: "0.00", balance_due: "2000.00", payment_status: "unpaid",
  public_token: null, signature: null, source_quote_id: null, created_at: "",
};

vi.mock("@/lib/hooks", () => ({
  // REL-445: the quote/event pages read their client-message ledger and
  // channel availability from these; unmocked they blow up the whole page.
  useClientMessages: () => ({ data: [], isLoading: false, mutate: vi.fn() }),
  useMessagingStatus: () => ({ data: undefined }),
  useEvent: () => ({ data: h.id === "new" ? null : existingEvent, error: null, isLoading: false, mutate: vi.fn() }),
  useAccounts: () => ({ data: [] }),
  useContacts: () => ({ data: [{ id: 3, name: "Jane Doe", phone: "", account: null }] }),
  useVenues: () => ({ data: [] }),
  useAddOnProducts: () => ({ data: [] }),
  useLaborRoles: () => ({ data: [] }),
  useStaff: () => ({ data: [] }),
  useUsers: () => ({ data: [] }),
  useSiteSettings: () => ({ data: { currency_symbol: "$", currency_code: "USD", date_format: "DD/MM/YYYY", price_rounding_step: "50", default_tax_rate: "0.0000", service_charge_default_pct: "0", service_charge_taxable_default: true, gratuity_default_pct: "0.00", guest_segments: [{ name: "Gents", is_default: true, counts_toward_total: true, price_multiplier: "1.0000", sort_order: 0 }, { name: "Ladies", is_default: false, counts_toward_total: true, price_multiplier: "1.0000", sort_order: 1 }] } }),
  useDateFormat: () => "DD/MM/YYYY",
  useFormatDateTime: () => (v: string | null) => v ?? "-",
  useEventTypes: () => ({ data: [{ id: 1, value: "wedding", label: "Wedding" }] }),
  useServiceStyles: () => ({ data: [] }),
  useMealTypes: () => ({ data: [] }),
  // The page renders CoursesEditor (REL-417), which reads the dish catalogue.
  useDishes: () => ({ data: [] }),
  // Deliberately listed cake-first to prove the prefill sorts by offset.
  useTimelinePresets: () => ({ data: [
    { id: 1, value: "cake_cutting", label: "Cake cutting", in_standard_day: true, standard_day_offset_minutes: 150 },
    { id: 2, value: "staff_arrival", label: "Staff arrive", in_standard_day: true, standard_day_offset_minutes: -210 },
  ] }),
  useProductLines: () => ({ data: [{ id: 5, name: "Catering", is_active: true, colour: "#000", round_robin_index: 0 }] }),
}));

vi.mock("@/lib/api", () => ({
  api: {
    createEvent: (...args: unknown[]) => { h.createEvent(...args); return Promise.resolve({ id: 55 }); },
    updateEvent: (...args: unknown[]) => { h.updateEvent(...args); return Promise.resolve({ id: 8 }); },
  },
}));

import EventPage from "./page";

describe("Event form — the run-of-show reaches the payload", () => {
  beforeEach(() => {
    h.createEvent.mockClear();
    h.updateEvent.mockClear();
    h.id = "new";
  });

  it("CREATE: the prefilled day reaches the payload, in run-of-show order", async () => {
    render(<EventPage />);

    fireEvent.click(screen.getByText("select-customer"));
    fireEvent.change(screen.getByLabelText("Guest Count"), { target: { value: "50" } });
    // The prefill lays this org's presets out in day order (staff arrive well
    // before cake cutting) even though the preset list isn't in that order.
    // The day is built AROUND the meal time, so it has to exist first —
    // building with no anchor is now refused rather than defaulted to 18:30.
    fireEvent.change(screen.getByLabelText("Meal Time"), { target: { value: "18:30" } });
    fireEvent.click(screen.getByText("+ Build a run-of-show"));
    expect(await screen.findByLabelText("Step 1 label")).toHaveValue("Staff arrive");

    fireEvent.click(screen.getByText("Create Event"));

    await waitFor(() => expect(h.createEvent).toHaveBeenCalledTimes(1));
    const payload = h.createEvent.mock.calls[0][0] as Record<string, unknown>;
    expect(payload.timeline_entries).toEqual([
      { time: "15:00:00", label: "Staff arrive", date: null },
      { time: "21:00:00", label: "Cake cutting", date: null },
    ]);
  });

  it("CREATE: no run-of-show ⇒ an empty list, and the meal-time anchor still saves", async () => {
    render(<EventPage />);

    fireEvent.click(screen.getByText("select-customer"));
    fireEvent.change(screen.getByLabelText("Guest Count"), { target: { value: "50" } });
    fireEvent.change(screen.getByLabelText("Meal Time"), { target: { value: "10:00" } });
    fireEvent.click(screen.getByText("Create Event"));

    await waitFor(() => expect(h.createEvent).toHaveBeenCalledTimes(1));
    const payload = h.createEvent.mock.calls[0][0] as Record<string, unknown>;
    expect(payload.timeline_entries).toEqual([]);
    expect(payload.meal_time).toMatch(/T10:00$/);
  });

  it("READ-ONLY: entries render instead of the four legacy rows (AC4)", async () => {
    h.id = "8";
    render(<EventPage />);

    expect(await screen.findByText("Staff arrive")).toBeInTheDocument();
    expect(screen.getByText("Cake cutting")).toBeInTheDocument();
    expect(screen.queryByText("Setup Time")).not.toBeInTheDocument();
  });

  // REL-447 — the read-only view now merges timed additional meals, matching the
  // PDF. New behaviour on THIS page (it previously showed entries only), so it is
  // pinned here and not only in the component's own test.
  it("READ-ONLY: a timed additional meal merges into the run-of-show", async () => {
    h.id = "8";
    existingEvent.additional_meals = [{
      id: 3, label: "Late-night snack", guest_count: 10, price_per_head: "5.00",
      meal_time: "2026-09-01T19:00:00Z", date: null, dishes: [], based_on_template: null,
      notes: "", audience: "custom", audience_segment: null, sort_order: 0,
    }] as unknown as typeof existingEvent.additional_meals;
    render(<EventPage />);

    // Scope to the Timeline card: the meal legitimately appears twice on the page,
    // here and in the Additional Meals section it belongs to.
    const heading = await screen.findByText("Timeline");
    const card = heading.closest("div")!.parentElement!;
    expect(within(card).getByText("Late-night snack")).toBeInTheDocument();
    const text = card.textContent ?? "";
    expect(text.indexOf("Staff arrive")).toBeLessThan(text.indexOf("Late-night snack"));
    existingEvent.additional_meals = [];
  });

  it("EDIT: existing entries hydrate, and a reorder is what gets saved", async () => {
    h.id = "8";
    render(<EventPage />);

    fireEvent.click(await screen.findByText("Edit"));

    expect(await screen.findByLabelText("Step 1 label")).toHaveValue("Staff arrive");
    expect(screen.getByLabelText("Step 1 time")).toHaveValue("15:00");

    // Reorder over the handle's arrow keys (the mouse drag needs a real
    // browser; the e2e covers that).
    fireEvent.keyDown(screen.getByLabelText(/^Reorder step 2/), { key: "ArrowUp" });
    fireEvent.click(screen.getByText("Save"));

    await waitFor(() => expect(h.updateEvent).toHaveBeenCalledTimes(1));
    const payload = h.updateEvent.mock.calls[0][1] as Record<string, unknown>;
    expect(payload.timeline_entries).toEqual([
      { time: "21:00:00", label: "Cake cutting", date: null },
      { time: "15:00:00", label: "Staff arrive", date: null },
    ]);
  });

  it("EDIT: removing every step sends an empty list, so the legacy slots come back", async () => {
    h.id = "8";
    render(<EventPage />);

    fireEvent.click(await screen.findByText("Edit"));
    fireEvent.click(await screen.findByLabelText("Remove step 1"));
    fireEvent.click(screen.getByLabelText("Remove step 1"));
    fireEvent.click(screen.getByText("Save"));

    await waitFor(() => expect(h.updateEvent).toHaveBeenCalledTimes(1));
    const payload = h.updateEvent.mock.calls[0][1] as Record<string, unknown>;
    expect(payload.timeline_entries).toEqual([]);
    // That the four slots reappear once the entries are gone is the component's
    // job, pinned in BookingTimelineField.test.tsx — this mock still serves the
    // pre-save event, so asserting it here would only test the stub.
  });
});
