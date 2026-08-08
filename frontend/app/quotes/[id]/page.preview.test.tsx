import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor, within } from "@testing-library/react";

// The quote page no longer works out what a quote costs — it asks the pricing
// engine and renders the answer. These tests drive the REAL page and pin that:
// the card shows the SERVER's figures (not a recomputation), the same draft that
// is priced is the one that saves, and the two modes agree about what a tax rate
// is. Mocked at the API boundary, so what's under test is our wiring.
const h = vi.hoisted(() => ({
  createQuote: vi.fn(),
  updateQuote: vi.fn(),
  pricingPreview: vi.fn(),
  push: vi.fn(),
  quote: null as Record<string, unknown> | null,
}));

vi.mock("next/navigation", () => ({
  useParams: () => ({ id: h.quote ? "7" : "new" }),
  useRouter: () => ({ push: h.push }),
}));

vi.mock("@/components/MenuBuilder", () => ({ default: () => null }));

vi.mock("@/lib/hooks", () => ({
  useQuote: () => ({ data: h.quote, error: null, isLoading: false, mutate: vi.fn() }),
  useAccounts: () => ({ data: [] }),
  useContacts: () => ({ data: [{ id: 3, name: "Jane Doe", phone: "", account: null }] }),
  useAddOnProducts: () => ({ data: [] }),
  useVenues: () => ({ data: [] }),
  useSiteSettings: () => ({ data: {
    currency_symbol: "$", currency_code: "USD", date_format: "MM/DD/YYYY",
    price_rounding_step: "50", tax_label: "Sales Tax",
    default_tax_rate: "0.08875", service_charge_default_pct: "20.00",
    service_charge_taxable_default: true, gratuity_default_pct: "0.00",
    guest_segments: [],
  } }),
  useDateFormat: () => "MM/DD/YYYY",
  useFormatDateTime: () => (v: string | null) => v ?? "-",
  useEventTypes: () => ({ data: [{ id: 1, value: "wedding", label: "Wedding" }] }),
  useServiceStyles: () => ({ data: [] }),
  useDishes: () => ({ data: [] }),
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
    createQuote: (...a: unknown[]) => { h.createQuote(...a); return Promise.resolve({ id: 99 }); },
    updateQuote: (...a: unknown[]) => { h.updateQuote(...a); return Promise.resolve({}); },
    pricingPreview: (...a: unknown[]) => h.pricingPreview(...a),
    getAccount: () => Promise.resolve({ contacts: [] }),
  },
}));

import { todayISO } from "@/lib/dateFormat";
import QuotePage from "./page";

/** A pricing response with figures nothing on the client could have produced —
 * if any of these appear on screen, they came from the server. */
const PRICED = {
  food: {
    menu_food: "1234.56",
    food_rows: null,
    meal_rows: [],
    meals_food: "0.00",
    food_total: "1234.56",
  },
  lines: { items: [], add_ons_subtotal: "77.77" },
  totals: {
    subtotal: "1312.33", charge_base: "1312.33", service_charge: "262.47",
    pre_tax_total: "1574.80", tax_base: "1574.80", tax_amount: "139.76",
    gratuity: "0.00", total: "1714.56",
  },
  rates: { tax_rate: "0.08875", service_charge_pct: "20", service_charge_taxable: true, gratuity_pct: "0" },
  warnings: [],
};

const SAVED_QUOTE = {
  id: 7, version: 1, status: "draft", status_display: "Draft", is_editable: true,
  lead: null, primary_contact: 3, contact_name: "Jane Doe", contact_email: "", contact_phone: "",
  is_b2b: false, account: null, event_date: "2026-09-01", venue: null, venue_address: "",
  product: null, guest_count: 100, guest_counts: [], big_eaters: false, big_eaters_percentage: 0,
  price_per_head: "45.00", food_total: "4500.00",
  event_type: "wedding", meal_type: "", booking_date: null, service_style: "", valid_until: null,
  setup_time: null, guest_arrival_time: null, meal_time: null, end_time: null,
  is_taxable: true, subtotal: "4500.00", tax_rate: "0.08500", tax_amount: "382.50", total: "4882.50",
  service_charge_pct: "0", service_charge_taxable: true, service_charge: "0.00",
  gratuity_pct: "0", gratuity: "0.00",
  dishes: [], dish_names: [], courses: [], dish_courses: {}, menu_choices: {}, menu_lines: null,
  based_on_template: null, additional_meals: [], timeline_entries: [], line_items: [],
  notes: "", internal_notes: "", sent_at: null, accepted_at: null,
  public_token: "tok", signature: null, event: null, created_by: 4, created_by_name: "Olivia",
  assigned_to: null, assigned_to_name: "", created_at: "", updated_at: "",
  pricing_snapshot: null as unknown,
};

const totalsCard = () => screen.getByText("Quote Total").closest("div")!.parentElement!;
const pickCustomer = () => {
  fireEvent.click(screen.getByLabelText("Customer"));
  fireEvent.click(screen.getByText("Jane Doe"));
};

beforeEach(() => {
  h.createQuote.mockClear();
  h.updateQuote.mockClear();
  h.push.mockClear();
  h.pricingPreview.mockReset();
  h.pricingPreview.mockResolvedValue(PRICED);
  h.quote = null;
});

describe("Quote CREATE — the card shows the engine's numbers", () => {
  it("renders the server's totals, not a client recomputation", async () => {
    render(<QuotePage />);
    fireEvent.change(screen.getByLabelText("Guest Count"), { target: { value: "100" } });

    // $1,714.56 is not derivable from anything the form holds — it can only have
    // come back from the endpoint.
    await waitFor(() => expect(screen.getByText("$1,714.56")).toBeInTheDocument());
    expect(screen.getByText("$1,312.33")).toBeInTheDocument(); // subtotal
    expect(screen.getByText("$139.76")).toBeInTheDocument();   // tax
    expect(screen.getByText("$77.77")).toBeInTheDocument();    // add-ons, from lines.add_ons_subtotal
  });

  it("prices the draft it would save (AC1)", async () => {
    render(<QuotePage />);
    fireEvent.change(screen.getByLabelText("Guest Count"), { target: { value: "100" } });
    await waitFor(() => expect(h.pricingPreview).toHaveBeenCalled());

    pickCustomer();
    fireEvent.click(screen.getByText("Create Quote"));
    await waitFor(() => expect(h.createQuote).toHaveBeenCalledTimes(1));

    const priced = h.pricingPreview.mock.calls.at(-1)![0] as Record<string, unknown>;
    const saved = h.createQuote.mock.calls[0][0] as Record<string, unknown>;
    // Every priced field is the saved field. Not "equivalent" — identical.
    for (const [key, value] of Object.entries(priced)) {
      expect(saved[key]).toEqual(value);
    }
  });

  it("holds the tax rate as a PERCENT and saves it as a fraction (AC9)", async () => {
    render(<QuotePage />);
    // Seeded from the org default (0.08875) and shown as a percent.
    const el = await screen.findByLabelText("Tax Rate (%)") as HTMLInputElement;
    expect(el.value).toBe("8.875");

    pickCustomer();
    fireEvent.change(screen.getByLabelText("Guest Count"), { target: { value: "10" } });
    fireEvent.click(screen.getByText("Create Quote"));
    await waitFor(() => expect(h.createQuote).toHaveBeenCalledTimes(1));
    expect((h.createQuote.mock.calls[0][0] as Record<string, unknown>).tax_rate).toBe("0.08875");
  });

  it("prices a typed tax rate as the fraction, never the raw percent", async () => {
    render(<QuotePage />);
    fireEvent.change(screen.getByLabelText("Tax Rate (%)"), { target: { value: "8.5" } });
    await waitFor(() => {
      const draft = h.pricingPreview.mock.calls.at(-1)![0] as Record<string, unknown>;
      expect(draft.tax_rate).toBe("0.08500");
    });
  });

  it("keeps the last good numbers when the engine errors, and says so (AC5)", async () => {
    render(<QuotePage />);
    fireEvent.change(screen.getByLabelText("Guest Count"), { target: { value: "100" } });
    await waitFor(() => expect(screen.getByText("$1,714.56")).toBeInTheDocument());

    h.pricingPreview.mockRejectedValue(new Error("network down"));
    fireEvent.change(screen.getByLabelText("Guest Count"), { target: { value: "101" } });

    await waitFor(() => expect(screen.getByText("Totals will refresh shortly")).toBeInTheDocument());
    // The money is still there — stale, but never blank.
    expect(screen.getByText("$1,714.56")).toBeInTheDocument();
    // And the form is still usable.
    expect(screen.getByLabelText("Guest Count")).toBeEnabled();
  });

  it("re-prices immediately on blur, without waiting out the debounce (AC3)", async () => {
    render(<QuotePage />);
    await waitFor(() => expect(h.pricingPreview).toHaveBeenCalled());
    const before = h.pricingPreview.mock.calls.length;

    const tax = screen.getByLabelText("Tax Rate (%)");
    fireEvent.change(tax, { target: { value: "6" } });
    fireEvent.blur(tax);

    // No timers advanced, no waiting — blur asks straight away.
    await waitFor(() => expect(h.pricingPreview.mock.calls.length).toBeGreaterThan(before));
    expect((h.pricingPreview.mock.calls.at(-1)![0] as Record<string, unknown>).tax_rate).toBe("0.06000");
  });
});

describe("Quote EDIT — the same engine, the same draft", () => {
  beforeEach(() => { h.quote = { ...SAVED_QUOTE }; });

  it("shows the STORED totals until editing starts", async () => {
    render(<QuotePage />);
    // View mode asks nothing and shows what was saved.
    expect(within(totalsCard()).getByText("$4,882.50")).toBeInTheDocument();
    expect(h.pricingPreview).not.toHaveBeenCalled();
  });

  it("switches to the engine's live answer once editing", async () => {
    render(<QuotePage />);
    fireEvent.click(screen.getByText("Edit Quote"));
    await waitFor(() => expect(screen.getByText("$1,714.56")).toBeInTheDocument());
  });

  it("keeps the saved figures on screen while the first preview is in flight", async () => {
    let release: (v: unknown) => void = () => {};
    h.pricingPreview.mockImplementation(() => new Promise((r) => { release = r; }));
    render(<QuotePage />);
    fireEvent.click(screen.getByText("Edit Quote"));

    // The request is out but nothing has come back — the card must not blank.
    await waitFor(() => expect(h.pricingPreview).toHaveBeenCalled());
    expect(within(totalsCard()).getByText("$4,882.50")).toBeInTheDocument();

    release(PRICED);
    await waitFor(() => expect(within(totalsCard()).getByText("$1,714.56")).toBeInTheDocument());
  });

  it("hydrates the stored fraction as a percent and saves it back unchanged (AC9)", async () => {
    render(<QuotePage />);
    fireEvent.click(screen.getByText("Edit Quote"));
    // 0.08500 stored → "8.5" in the field, not 850 and not 0.085.
    expect((screen.getByLabelText("Tax Rate (%)") as HTMLInputElement).value).toBe("8.5");

    fireEvent.click(screen.getByText("Save Quote"));
    await waitFor(() => expect(h.updateQuote).toHaveBeenCalledTimes(1));
    // Round-tripped without drift.
    expect((h.updateQuote.mock.calls[0][1] as Record<string, unknown>).tax_rate).toBe("0.08500");
  });

  it("prices the draft it would save (AC1)", async () => {
    render(<QuotePage />);
    fireEvent.click(screen.getByText("Edit Quote"));
    fireEvent.change(screen.getByLabelText("Guest Count"), { target: { value: "120" } });
    await waitFor(() => expect(h.pricingPreview).toHaveBeenCalled());

    fireEvent.click(screen.getByText("Save Quote"));
    await waitFor(() => expect(h.updateQuote).toHaveBeenCalledTimes(1));

    const priced = h.pricingPreview.mock.calls.at(-1)![0] as Record<string, unknown>;
    const saved = h.updateQuote.mock.calls[0][1] as Record<string, unknown>;
    for (const [key, value] of Object.entries(priced)) {
      expect(saved[key]).toEqual(value);
    }
  });

  it("renders the stored SNAPSHOT's breakdown in view mode when there is one", async () => {
    h.quote = { ...SAVED_QUOTE, pricing_snapshot: {
      ...PRICED,
      food: { ...PRICED.food, food_rows: [
        { name: "Adults", count: 80, rate: "45.00", amount: "3600.00" },
        { name: "Kids", count: 20, rate: "22.50", amount: "450.00" },
      ] },
    } };
    render(<QuotePage />);
    // The itemized rows the save produced — rendered, not recomputed.
    expect(screen.getByText("Adults — 80 × $45.00")).toBeInTheDocument();
    expect(screen.getByText("Kids — 20 × $22.50")).toBeInTheDocument();
    expect(screen.getByText("$1,714.56")).toBeInTheDocument();
    expect(h.pricingPreview).not.toHaveBeenCalled();
  });

  it("falls back to the flat columns for a quote saved before snapshots", async () => {
    h.quote = { ...SAVED_QUOTE, pricing_snapshot: null };
    render(<QuotePage />);
    const card = within(totalsCard());
    expect(card.getByText("$4,882.50")).toBeInTheDocument();
    expect(card.getAllByText("$4,500.00").length).toBeGreaterThan(0);
  });
});

describe("Quote CREATE and EDIT post the same body for the same state (AC6)", () => {
  it("agrees field for field on everything that isn't create-only", async () => {
    // Same booking, entered twice: once on the create form, once on the edit form.
    const drive = () => {
      fireEvent.change(screen.getByLabelText("Guest Count"), { target: { value: "60" } });
      fireEvent.change(screen.getByLabelText("Tax Rate (%)"), { target: { value: "8.875" } });
    };

    h.quote = null;
    const created = render(<QuotePage />);
    drive();
    pickCustomer();
    fireEvent.click(screen.getByText("Create Quote"));
    await waitFor(() => expect(h.createQuote).toHaveBeenCalledTimes(1));
    created.unmount();

    // The create form defaults the event date to today, so the saved quote has to
    // agree for "the same booking, entered twice" to mean anything.
    // Per-head price lives in MenuBuilder, which these tests stub out, so neither
    // form can set it — the saved quote must not carry one either.
    h.quote = { ...SAVED_QUOTE, primary_contact: 3, event_date: todayISO(), price_per_head: null,
      // The create form's own defaults (event type from the form, charges seeded
      // from org settings), so both forms start from the same booking.
      event_type: "other", service_charge_pct: "20.00", gratuity_pct: "0.00" };
    render(<QuotePage />);
    fireEvent.click(screen.getByText("Edit Quote"));
    drive();
    fireEvent.click(screen.getByText("Save Quote"));
    await waitFor(() => expect(h.updateQuote).toHaveBeenCalledTimes(1));

    const createBody = h.createQuote.mock.calls[0][0] as Record<string, unknown>;
    const editBody = h.updateQuote.mock.calls[0][1] as Record<string, unknown>;

    // `lead` and `assigned_to` are the only fields create adds.
    expect(Object.keys(createBody).sort()).toEqual(
      [...Object.keys(editBody), "lead", "assigned_to"].sort(),
    );
    for (const key of Object.keys(editBody)) {
      expect({ [key]: createBody[key] }).toEqual({ [key]: editBody[key] });
    }
  });
});
