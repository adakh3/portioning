import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";

// Bound before anything spies on it — see the beforeEach below.
const realCreate = document.createElement.bind(document);

// REL-444 AC1 — the BEO download button on the event page. A unit test of
// `api.downloadEventBEO` would prove the fetch URL and nothing about whether a
// button reaches it, which is the half that actually broke before.
const h = vi.hoisted(() => ({
  push: vi.fn(),
  id: "8",
  downloadEventBEO: vi.fn(() =>
    Promise.resolve({ blob: new Blob(["%PDF"]), filename: "BEO-8-Rev3.pdf" })),
  downloadEventPDF: vi.fn(() => Promise.resolve(new Blob(["%PDF"]))),
  issueBEORevision: vi.fn(() => Promise.resolve({ id: 8, beo_revision: 4 })),
  anchors: [] as HTMLAnchorElement[],
}));

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
  default: () => <button type="button">select-customer</button>,
}));

const existingEvent = {
  id: 8, name: "Khan Wedding", date: "2026-09-01", event_date: "2026-09-01",
  is_b2b: false, account: null, account_name: null,
  primary_contact: 3, contact_name: "Jane Doe", contact_phone: "",
  venue: null, venue_name: null, venue_address: "", venue_city: "", venue_state: "", venue_zip: "",
  product: 5, product_name: "Catering", assigned_to: 7, assigned_to_name: "Sam Sales",
  created_by: 7, created_by_name: "Sam Sales",
  event_type: "wedding", meal_type: "", service_style: "plated", booking_date: "",
  price_per_head: "40.00", status: "confirmed", status_display: "Confirmed",
  beo_revision: 3, beo_revised_at: "2026-08-01T10:00:00Z",
  is_taxable: false, tax_rate: "0.0000", subtotal: "2000.00", tax_amount: "0.00", total: "2000.00",
  service_charge_pct: "0", service_charge_taxable: true, service_charge: "0.00",
  gratuity_pct: "0", gratuity: "0.00",
  guest_count: 50, gents: 0, ladies: 0, guest_counts: [],
  big_eaters: false, big_eaters_percentage: 0,
  setup_time: null, guest_arrival_time: null, meal_time: null, end_time: null,
  timeline_entries: [], guaranteed_count: null, final_count: null, final_count_due: null,
  notes: "", kitchen_instructions: "", banquet_instructions: "", setup_instructions: "",
  dishes: [], dish_comments: [], line_items: [], additional_meals: [],
  courses: [], dish_courses: {}, menu_choices: {}, menu_lines: null, finals_status: null,
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
  useEvent: () => ({ data: existingEvent, error: null, isLoading: false, mutate: vi.fn() }),
  useAccounts: () => ({ data: [] }),
  useContacts: () => ({ data: [{ id: 3, name: "Jane Doe", phone: "", account: null }] }),
  useVenues: () => ({ data: [] }),
  useAddOnProducts: () => ({ data: [] }),
  useLaborRoles: () => ({ data: [] }),
  useStaff: () => ({ data: [] }),
  useUsers: () => ({ data: [] }),
  useSiteSettings: () => ({ data: { currency_symbol: "$", currency_code: "USD", date_format: "DD/MM/YYYY", price_rounding_step: "50", default_tax_rate: "0.0000", service_charge_default_pct: "0", service_charge_taxable_default: true, gratuity_default_pct: "0.00", guest_segments: [{ name: "Adults", is_default: true, counts_toward_total: true, price_multiplier: "1.0000", sort_order: 0 }] } }),
  useDateFormat: () => "DD/MM/YYYY",
  useFormatDateTime: () => (v: string | null) => v ?? "-",
  useEventTypes: () => ({ data: [{ id: 1, value: "wedding", label: "Wedding" }] }),
  useServiceStyles: () => ({ data: [{ id: 2, value: "plated", label: "Plated" }] }),
  useMealTypes: () => ({ data: [] }),
  useDishes: () => ({ data: [] }),
  useTimelinePresets: () => ({ data: [] }),
  useProductLines: () => ({ data: [{ id: 5, name: "Catering", is_active: true, colour: "#000", round_robin_index: 0 }] }),
}));

vi.mock("@/lib/api", () => ({
  api: {
    createEvent: () => Promise.resolve({ id: 55 }),
    updateEvent: () => Promise.resolve({ id: 8 }),
    downloadEventBEO: h.downloadEventBEO,
    downloadEventPDF: h.downloadEventPDF,
    issueBEORevision: h.issueBEORevision,
  },
}));

import EventPage from "./page";

/** The BEO button now shows its revision ("BEO · Rev 3"), so match the prefix. */
const findBEOButton = () => screen.findByRole("button", { name: /^BEO/ });

describe("Event page — BEO download (REL-444 AC1)", () => {
  beforeEach(() => {
    h.downloadEventBEO.mockClear();
    h.downloadEventPDF.mockClear();
    h.issueBEORevision.mockClear();
    h.anchors = [];
    // jsdom has no object-URL plumbing; the click path needs both to exist.
    URL.createObjectURL = vi.fn(() => "blob:beo");
    URL.revokeObjectURL = vi.fn();
    // Capture the synthetic <a> the download builds, so the saved filename is
    // assertable — it's the only place the revision reaches the user's disk.
    // `realCreate` is bound ONCE at module scope: re-reading document.createElement
    // here would bind the previous test's spy and recurse until the stack blew.
    vi.spyOn(document, "createElement").mockImplementation(((tag: string, ...rest: []) => {
      const el = realCreate(tag, ...rest);
      if (tag === "a") {
        (el as HTMLAnchorElement).click = vi.fn();
        h.anchors.push(el as HTMLAnchorElement);
      }
      return el;
    }) as typeof document.createElement);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("offers a BEO button alongside the function sheet", async () => {
    render(<EventPage />);
    await screen.findByText("Download PDF");
    expect(screen.getByRole("button", { name: /^BEO/ })).toBeTruthy();
  });

  it("downloads THIS event's BEO, not the function sheet", async () => {
    render(<EventPage />);
    fireEvent.click(await findBEOButton());

    await waitFor(() => expect(h.downloadEventBEO).toHaveBeenCalledWith(8));
    expect(h.downloadEventPDF).not.toHaveBeenCalled();
  });

  it("still downloads the function sheet from its own button", async () => {
    render(<EventPage />);
    fireEvent.click(await screen.findByText("Download PDF"));

    await waitFor(() => expect(h.downloadEventPDF).toHaveBeenCalledWith(8));
    expect(h.downloadEventBEO).not.toHaveBeenCalled();
  });

  it("saves the file under the server's revision-stamped name", async () => {
    // The server is the only party that knows which revision this download became —
    // the page's copy of the event is already one behind. Ignoring its filename is
    // how every revision would have landed on disk as the same "BEO-8.pdf".
    render(<EventPage />);
    fireEvent.click(await findBEOButton());

    // The page mounts its own <a>s (nav links); the download one is the one that
    // actually carries a filename.
    await waitFor(() => expect(h.anchors.filter((a) => a.download).length).toBe(1));
    expect(h.anchors.filter((a) => a.download)[0].download).toBe("BEO-8-Rev3.pdf");
  });

  it("falls back to a plain name when the server sends none", async () => {
    h.downloadEventBEO.mockResolvedValueOnce({ blob: new Blob(["%PDF"]), filename: "" });
    render(<EventPage />);
    fireEvent.click(await findBEOButton());

    // The page mounts its own <a>s (nav links); the download one is the one that
    // actually carries a filename.
    await waitFor(() => expect(h.anchors.filter((a) => a.download).length).toBe(1));
    expect(h.anchors.filter((a) => a.download)[0].download).toBe("BEO-8.pdf");
  });

  it("shows which revision the current sheet is", async () => {
    render(<EventPage />);
    expect((await findBEOButton()).textContent).toContain("Rev 3");
  });

  it("downloading a copy never issues a revision", async () => {
    // The whole point of splitting the two: printing a second copy for the venue
    // must not tell the kitchen that its copy went stale.
    render(<EventPage />);
    fireEvent.click(await findBEOButton());

    await waitFor(() => expect(h.downloadEventBEO).toHaveBeenCalled());
    expect(h.issueBEORevision).not.toHaveBeenCalled();
  });

  it("issues a revision only from its own button, and never downloads", async () => {
    render(<EventPage />);
    fireEvent.click(await screen.findByText("New revision"));

    await waitFor(() => expect(h.issueBEORevision).toHaveBeenCalledWith(8));
    expect(h.downloadEventBEO).not.toHaveBeenCalled();
  });

  it("surfaces a failed revision instead of failing silently", async () => {
    h.issueBEORevision.mockRejectedValueOnce(new Error("Event not found"));
    render(<EventPage />);
    fireEvent.click(await screen.findByText("New revision"));

    expect(await screen.findByText(/Event not found/)).toBeTruthy();
  });

  it("surfaces a failed BEO download instead of failing silently", async () => {
    h.downloadEventBEO.mockRejectedValueOnce(new Error("Event not found"));
    render(<EventPage />);
    fireEvent.click(await findBEOButton());

    expect(await screen.findByText(/Event not found/)).toBeTruthy();
  });
});
