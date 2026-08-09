import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor, within } from "@testing-library/react";

// The event page's half of REL-465: the Pricing card is the SERVER's answer, and
// the draft that gets priced is the draft that gets saved. Mirrors the quote page's
// matrix — the two surfaces drifted precisely because only one of them was tested.
const h = vi.hoisted(() => ({
  updateEvent: vi.fn(),
  createEvent: vi.fn(),
  pricingPreview: vi.fn(),
  push: vi.fn(),
  event: null as Record<string, unknown> | null,
  segments: [] as Record<string, unknown>[],
}));

vi.mock("next/navigation", () => ({
  useParams: () => ({ id: h.event ? "8" : "new" }),
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

vi.mock("@/lib/hooks", () => ({
  useEvent: () => ({ data: h.event, error: null, isLoading: false, mutate: vi.fn() }),
  useAccounts: () => ({ data: [] }),
  useContacts: () => ({ data: [{ id: 3, name: "Jane Doe", phone: "", account: null }] }),
  useVenues: () => ({ data: [] }),
  useAddOnProducts: () => ({ data: [] }),
  useLaborRoles: () => ({ data: [] }),
  useStaff: () => ({ data: [] }),
  useUsers: () => ({ data: [] }),
  useSiteSettings: () => ({ data: {
    currency_symbol: "$", currency_code: "USD", date_format: "MM/DD/YYYY",
    price_rounding_step: "50", tax_label: "Sales Tax", default_tax_rate: "0.08875",
    service_charge_default_pct: "20.00", service_charge_taxable_default: true,
    gratuity_default_pct: "0.00", guest_segments: h.segments,
  } }),
  useDateFormat: () => "MM/DD/YYYY",
  useFormatDateTime: () => (v: string | null) => v ?? "-",
  useEventTypes: () => ({ data: [{ id: 1, value: "wedding", label: "Wedding" }] }),
  useServiceStyles: () => ({ data: [] }),
  useDishes: () => ({ data: [] }),
  useCategories: () => ({ data: [] }),
  useMenus: () => ({ data: [], isLoading: false }),
  useMealTypes: () => ({ data: [] }),
  useTimelinePresets: () => ({ data: [] }),
  useProductLines: () => ({ data: [] }),
}));

vi.mock("@/lib/api", () => ({
  api: {
    createEvent: (...a: unknown[]) => { h.createEvent(...a); return Promise.resolve({ id: 55 }); },
    updateEvent: (...a: unknown[]) => { h.updateEvent(...a); return Promise.resolve({}); },
    pricingPreview: (...a: unknown[]) => h.pricingPreview(...a),
    priceEstimate: () => Promise.resolve({ price_per_head: 0, has_unpriced: false }),
    menuPriceCheck: () => Promise.resolve({ adjusted_price: 0, tier_label: "", breakdown: [], total_adjustment: 0 }),
    getMenu: () => Promise.resolve({ portions: [], courses: [], dish_courses: {}, price_tiers: [] }),
  },
  collectErrorMessages: () => [],
}));

import EventPage from "./page";

/** Figures nothing on the client could have produced. AC7's shape: a per_guest
 * line and a discount, whose add-ons subtotal is the engine's, not a client sum. */
const PRICED = {
  food: { menu_food: "2345.67", food_rows: null, meal_rows: [], meals_food: "0.00", food_total: "2345.67" },
  lines: {
    items: [
      { description: "Late night snack", category: "food", unit: "per_guest", line_total: "300.00" },
      { description: "Goodwill", category: "discount", unit: "flat", line_total: "-50.00" },
    ],
    add_ons_subtotal: "250.00",
  },
  totals: {
    subtotal: "2595.67", charge_base: "2595.67", service_charge: "519.13",
    pre_tax_total: "3114.80", tax_base: "3114.80", tax_amount: "276.44",
    gratuity: "0.00", total: "3391.24",
  },
  rates: { tax_rate: "0.08875", service_charge_pct: "20", service_charge_taxable: true, gratuity_pct: "0" },
  warnings: [],
};

const SAVED_EVENT = {
  id: 8, name: "Khan Wedding", date: "2026-09-01", event_date: "2026-09-01",
  is_b2b: false, account: null, account_name: null,
  primary_contact: 3, contact_name: "Jane Doe", contact_phone: "",
  venue: null, venue_name: null, venue_address: "", venue_city: "", venue_state: "", venue_zip: "",
  product: null, product_name: "", assigned_to: 7, assigned_to_name: "Sam Sales",
  created_by: 7, created_by_name: "Sam Sales",
  event_type: "wedding", meal_type: "", service_style: "", booking_date: "",
  price_per_head: "40.00", status: "tentative", status_display: "Tentative",
  is_taxable: true, tax_rate: "0.08500",
  subtotal: "2000.00", tax_amount: "170.00", total: "2170.00",
  service_charge_pct: "0", service_charge_taxable: true, service_charge: "0.00",
  gratuity_pct: "0", gratuity: "0.00",
  guest_count: 50, gents: 0, ladies: 0, guest_counts: [],
  big_eaters: false, big_eaters_percentage: 0,
  setup_time: null, guest_arrival_time: null, meal_time: null, end_time: null,
  timeline_entries: [], guaranteed_count: null, final_count: null, final_count_due: null,
  notes: "", kitchen_instructions: "", banquet_instructions: "", setup_instructions: "",
  dishes: [], dish_comments: [], line_items: [], additional_meals: [],
  courses: [], dish_courses: {}, menu_choices: {}, finals_status: null,
  based_on_template: null, constraint_override: null,
  shifts: [], equipment_reservations: [], invoices: [], payments: [],
  amount_paid: "0.00", balance_due: "2170.00", payment_status: "unpaid",
  public_token: null, signature: null, source_quote_id: null, created_at: "",
  pricing_snapshot: null as unknown,
};

const pricingCard = () => screen.getByText("Pricing").closest("div")!.parentElement!;

beforeEach(() => {
  h.updateEvent.mockClear();
  h.createEvent.mockClear();
  h.push.mockClear();
  h.pricingPreview.mockReset();
  h.pricingPreview.mockResolvedValue(PRICED);
  h.event = { ...SAVED_EVENT };
  h.segments = [];
});

describe("Event pricing — the engine's answer, not the browser's", () => {
  it("renders the server's totals while editing", async () => {
    render(<EventPage />);
    fireEvent.click(screen.getByRole("button", { name: /Edit/i }));

    await waitFor(() => expect(within(pricingCard()).getByText("$3,391.24")).toBeInTheDocument());
    expect(within(pricingCard()).getByText("$2,595.67")).toBeInTheDocument();
  });

  it("takes the add-ons row from the engine, not a client sum (AC7)", async () => {
    render(<EventPage />);
    fireEvent.click(screen.getByRole("button", { name: /Edit/i }));

    // $250.00 is `lines.add_ons_subtotal` — the engine's rounded answer for a
    // per_guest line plus a discount. The page used to reduce() the rows itself,
    // unrounded, while the quote page derived the same figure by subtraction: one
    // row, two engines, two answers.
    await waitFor(() => expect(within(pricingCard()).getByText("$250.00")).toBeInTheDocument());
  });

  it("prices the draft it would save (AC1)", async () => {
    render(<EventPage />);
    fireEvent.click(screen.getByRole("button", { name: /Edit/i }));
    fireEvent.change(screen.getByLabelText("Guest Count"), { target: { value: "60" } });
    await waitFor(() => expect(h.pricingPreview).toHaveBeenCalled());

    fireEvent.click(screen.getByRole("button", { name: /Save/i }));
    await waitFor(() => expect(h.updateEvent).toHaveBeenCalledTimes(1));

    const priced = h.pricingPreview.mock.calls.at(-1)![0] as Record<string, unknown>;
    const saved = h.updateEvent.mock.calls[0][1] as Record<string, unknown>;
    for (const [key, value] of Object.entries(priced)) {
      // The rate travels beside the gate but is not the event form's to change.
      if (key === "tax_rate") { expect(value).toBe(SAVED_EVENT.tax_rate); continue; }
      expect(saved[key]).toEqual(value);
    }
  });

  it("sends the event's OWN rate, so a taxable event is not priced at zero", async () => {
    render(<EventPage />);
    fireEvent.click(screen.getByRole("button", { name: /Edit/i }));

    await waitFor(() => expect(h.pricingPreview).toHaveBeenCalled());
    const draft = h.pricingPreview.mock.calls.at(-1)![0] as Record<string, unknown>;
    // The gap this closes: an event save carries `is_taxable` and no rate, so a
    // draft built from it alone previewed no tax at all.
    expect(draft.is_taxable).toBe(true);
    expect(draft.tax_rate).toBe("0.08500");
  });

  it("re-prices the moment the taxable switch is flipped, not 300ms later", async () => {
    // FAKE timers, deliberately. With real ones this test passes even if the
    // immediate re-price is deleted, because `waitFor` waits a second and the
    // 300 ms debounce quietly satisfies it — the assertion then proves only that
    // *something* eventually fired. Holding the clock still is what separates
    // "immediately" from "soon".
    vi.useFakeTimers({ shouldAdvanceTime: false });
    try {
      render(<EventPage />);
      fireEvent.click(screen.getByRole("button", { name: /Edit/i }));
      await vi.advanceTimersByTimeAsync(400);   // let the initial debounced call go
      const before = h.pricingPreview.mock.calls.length;

      // A toggle is a decision, not a keystroke — the number moves at once.
      fireEvent.click(within(pricingCard()).getByRole("checkbox"));
      await Promise.resolve();                  // effects only; no timer advanced

      expect(h.pricingPreview.mock.calls.length).toBeGreaterThan(before);
      const draft = h.pricingPreview.mock.calls.at(-1)![0] as Record<string, unknown>;
      // And it asks about the state AFTER the toggle. Flushing from the change
      // handler sent the pre-toggle draft, so this said `true`.
      expect(draft.is_taxable).toBe(false);
    } finally {
      vi.useRealTimers();
    }
  });

  it("shows the STORED totals when not editing, and asks nothing", async () => {
    render(<EventPage />);
    expect(within(pricingCard()).getByText("$2,170.00")).toBeInTheDocument();
    expect(h.pricingPreview).not.toHaveBeenCalled();
  });

  it("keeps the saved figures up while the first preview is in flight", async () => {
    h.pricingPreview.mockImplementation(() => new Promise(() => {}));
    render(<EventPage />);
    fireEvent.click(screen.getByRole("button", { name: /Edit/i }));

    await waitFor(() => expect(h.pricingPreview).toHaveBeenCalled());
    expect(within(pricingCard()).getByText("$2,170.00")).toBeInTheDocument();
  });

  it("renders the stored snapshot's breakdown in view mode when there is one", async () => {
    h.event = { ...SAVED_EVENT, pricing_snapshot: {
      ...PRICED,
      food: { ...PRICED.food, food_rows: [
        { name: "Adults", count: 40, rate: "40.00", amount: "1600.00" },
        { name: "Kids", count: 10, rate: "20.00", amount: "200.00" },
      ] },
    } };
    render(<EventPage />);
    expect(screen.getByText("Adults — 40 × $40.00")).toBeInTheDocument();
    expect(screen.getByText("Kids — 10 × $20.00")).toBeInTheDocument();
    expect(h.pricingPreview).not.toHaveBeenCalled();
  });

  it("labels the tax row with the rate the event actually carries", async () => {
    render(<EventPage />);
    // 0.08500 stored → "8.5%", not "9%" (the old `.toFixed(0)`).
    expect(within(pricingCard()).getByText(/Sales Tax \(8\.5%\)/)).toBeInTheDocument();
  });

  it("keeps the last good numbers when the engine errors, and says so", async () => {
    render(<EventPage />);
    fireEvent.click(screen.getByRole("button", { name: /Edit/i }));
    await waitFor(() => expect(within(pricingCard()).getByText("$3,391.24")).toBeInTheDocument());

    h.pricingPreview.mockRejectedValue(new Error("network down"));
    fireEvent.change(screen.getByLabelText("Guest Count"), { target: { value: "61" } });

    await waitFor(() => expect(screen.getByText("Totals will refresh shortly")).toBeInTheDocument());
    expect(within(pricingCard()).getByText("$3,391.24")).toBeInTheDocument();
  });

  it("says why a draft would be refused rather than showing an impossible number", async () => {
    h.pricingPreview.mockResolvedValue({
      ...PRICED,
      warnings: ["Guest breakdown covers 999 guests but the booking is for 50."],
    });
    render(<EventPage />);
    fireEvent.click(screen.getByRole("button", { name: /Edit/i }));

    await waitFor(() =>
      expect(screen.getByText("Guest breakdown covers 999 guests but the booking is for 50.")).toBeInTheDocument());
  });
});

// The path EVERY event in production takes today: `pricing_snapshot` is only
// written from REL-464 onward and nothing backfills it. Untested, this is where a
// review found the card printing a NEGATIVE add-ons row.
describe("Event pricing — an event saved before snapshots", () => {
  const SEGMENTS = [
    { name: "Adults", is_default: true, counts_toward_total: true, price_multiplier: "1.0000", sort_order: 0 },
    { name: "Kids", is_default: false, counts_toward_total: true, price_multiplier: "0.5000", sort_order: 1 },
  ];

  /** 100 guests (80 Adults + 20 Kids) at $100/head = $9,000 food, plus a $500
   * rental → the $9,500 subtotal the server stored. */
  const LEGACY = {
    ...SAVED_EVENT,
    pricing_snapshot: null,
    price_per_head: "100.00",
    guest_count: 100,
    guest_counts: [
      { segment: "Adults", count: 80, counts_toward_total: true },
      { segment: "Kids", count: 20, counts_toward_total: true },
    ],
    line_items: [
      { id: 1, category: "rental", description: "Chairs", quantity: "1", unit: "flat",
        unit_price: "500.00", line_total: "500.00", sort_order: 0, variant: null },
    ],
    subtotal: "9500.00", tax_amount: "0.00", total: "9500.00", is_taxable: false,
  };

  it("shows the add-ons the customer is charged, itemised by segment", async () => {
    h.event = LEGACY;
    h.segments = SEGMENTS;
    render(<EventPage />);
    const card = within(pricingCard());

    expect(card.getByText("Adults — 80 × $100.00")).toBeInTheDocument();
    expect(card.getByText("Kids — 20 × $50.00")).toBeInTheDocument();
    expect(card.getByText("$500.00")).toBeInTheDocument();
    // Subtotal and total both, since this event isn't taxed.
    expect(card.getAllByText("$9,500.00").length).toBeGreaterThan(0);
  });

  it("never shows a NEGATIVE add-ons row when the org's rates moved since the save", async () => {
    // The org raised Kids to full price AFTER this event was saved. Deriving the
    // add-ons row as `subtotal − food` then makes the client's food ($10,000)
    // exceed the stored subtotal ($9,500) and prints "Add-ons −$500.00" on a
    // booking whose only add-on is a $500 rental.
    h.event = LEGACY;
    h.segments = [
      SEGMENTS[0],
      { ...SEGMENTS[1], price_multiplier: "1.0000" },
    ];
    render(<EventPage />);

    expect(within(pricingCard()).queryByText("-$500.00")).not.toBeInTheDocument();
    expect(within(pricingCard()).queryByText("$-500.00")).not.toBeInTheDocument();
    expect(within(pricingCard()).getByText("$500.00")).toBeInTheDocument();
  });

  it("is right on the first render, before org settings have loaded", async () => {
    // `segmentMeta` is empty until `useSiteSettings` resolves, so the food mirror
    // briefly prices every cover at full rate. The add-ons row must not flicker
    // negative in that window.
    h.event = LEGACY;
    h.segments = [];
    render(<EventPage />);
    expect(within(pricingCard()).getByText("$500.00")).toBeInTheDocument();
  });
});

describe("Event pricing — create mode", () => {
  beforeEach(() => { h.event = null; });

  it("opens at zero rather than blank, and asks the engine", async () => {
    render(<EventPage />);
    // Nothing is priced yet, so the card shows zeros — not an empty box.
    expect(within(pricingCard()).getAllByText("$0.00").length).toBeGreaterThan(0);
    await waitFor(() => expect(h.pricingPreview).toHaveBeenCalled());
  });

  it("prices a NEW event as untaxed, matching the column default", async () => {
    // `Event.is_taxable` defaults to False — the opposite of `Quote`'s default.
    // Previewing a new event as taxable would show tax the save will not store.
    render(<EventPage />);
    await waitFor(() => expect(h.pricingPreview).toHaveBeenCalled());
    const draft = h.pricingPreview.mock.calls.at(-1)![0] as Record<string, unknown>;
    expect(draft.is_taxable).toBe(false);
    // The rate still travels, so ticking the box prices correctly at once.
    expect(draft.tax_rate).toBe("0.08875");
  });

  it("renders the engine's answer once it arrives", async () => {
    render(<EventPage />);
    await waitFor(() => expect(within(pricingCard()).getByText("$3,391.24")).toBeInTheDocument());
  });
});
