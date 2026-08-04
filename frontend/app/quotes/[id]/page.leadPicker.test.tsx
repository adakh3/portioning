import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor, within } from "@testing-library/react";

// "Link to Lead" is a searchable picker, not a native <select>: it lists every open
// lead the org has, so it grows forever. These drive the REAL page through the REAL
// picker and assert the lead's details still prefill the quote and reach the payload
// — the handler used to take a change event and now takes the id directly.
const h = vi.hoisted(() => ({ createQuote: vi.fn(), push: vi.fn() }));

vi.mock("next/navigation", () => ({
  useParams: () => ({ id: "new" }),
  useRouter: () => ({ push: h.push }),
}));

vi.mock("@/components/MenuBuilder", () => ({ default: () => null }));

const LEADS = [
  { id: 11, contact_name: "Hamza", event_type: "wedding", event_type_display: "Mehndi",
    event_date: "2026-11-12", guest_estimate: 250, meal_type: "", service_style: "",
    account: null, product: 5, status: "new" },
  // Same contact name, different event — only the hint tells them apart.
  { id: 12, contact_name: "Hamza", event_type: "wedding", event_type_display: "Wedding",
    event_date: "2026-12-26", guest_estimate: 400, meal_type: "", service_style: "",
    account: null, product: null, status: "new" },
  { id: 13, contact_name: "Rimsha Kiyani", event_type: "other", event_type_display: "other",
    event_date: "2026-10-01", guest_estimate: 80, meal_type: "", service_style: "",
    account: null, product: null, status: "new" },
];

vi.mock("@/lib/hooks", () => ({
  useQuote: () => ({ data: null, error: null, isLoading: false, mutate: vi.fn() }),
  useAccounts: () => ({ data: [] }),
  useContacts: () => ({ data: [{ id: 3, name: "Jane Doe", phone: "", account: null }] }),
  useAddOnProducts: () => ({ data: [] }),
  useVenues: () => ({ data: [] }),
  useSiteSettings: () => ({ data: { currency_symbol: "£", currency_code: "GBP", date_format: "DD/MM/YYYY", price_rounding_step: "50", default_tax_rate: "0.2000", service_charge_default_pct: "20.00", service_charge_taxable_default: false, gratuity_default_pct: "0.00" } }),
  useDateFormat: () => "DD/MM/YYYY",
  useFormatDateTime: () => (v: string | null) => v ?? "-",
  useEventTypes: () => ({ data: [{ id: 1, value: "wedding", label: "Wedding" }] }),
  useServiceStyles: () => ({ data: [] }),
  useDishes: () => ({ data: [] }),
  useMealTypes: () => ({ data: [] }),
  useTimelinePresets: () => ({ data: [] }),
  useAllLeads: () => ({ data: LEADS }),
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
    getAccount: () => Promise.resolve({ contacts: [] }),
  },
}));

import QuoteCreatePage from "./page";

const openPicker = () => fireEvent.click(screen.getByLabelText("Link to Lead"));
const search = (t: string) =>
  fireEvent.change(screen.getByLabelText("Search link to lead"), { target: { value: t } });

describe("Quote create — linking to a lead", () => {
  beforeEach(() => { h.createQuote.mockClear(); h.push.mockClear(); });

  it("is a searchable picker, not a list of every lead at once", () => {
    render(<QuoteCreatePage />);
    // The native <select> is gone — that was the control that made 50 leads a
    // screen-height scroll.
    expect(screen.queryByRole("combobox", { name: "Link to Lead" })).not.toBeInTheDocument();
    expect(screen.getByLabelText("Link to Lead")).toHaveTextContent("-- No lead (standalone quote) --");
  });

  it("filters to one lead and prefills the quote from it", async () => {
    render(<QuoteCreatePage />);
    openPicker();
    search("rimsha");
    const listed = within(screen.getByRole("listbox")).getAllByRole("option")
      .map((b) => b.textContent).filter((t) => !t?.includes("No lead"));
    expect(listed).toHaveLength(1);
    fireEvent.click(screen.getByText("Rimsha Kiyani"));

    // The lead's details land on the form.
    expect(screen.getByLabelText("Link to Lead")).toHaveTextContent("Rimsha Kiyani");
    await waitFor(() => expect(screen.getByLabelText("Guest Count")).toHaveValue("80"));
  });

  it("tells two leads with the same name apart by their date", async () => {
    // Both are "Hamza". The date in the hint is the only thing separating them,
    // which is why the hint has to be searchable and not decorative.
    render(<QuoteCreatePage />);
    openPicker();
    search("26/12");
    const listed = within(screen.getByRole("listbox")).getAllByRole("option")
      .map((b) => b.textContent).filter((t) => !t?.includes("No lead"));
    expect(listed).toEqual(["Hamza" + "Wedding · 26/12/2026"]);
    fireEvent.click(screen.getByText("Wedding · 26/12/2026"));
    // The 400-guest Hamza, not the 250-guest one.
    await waitFor(() => expect(screen.getByLabelText("Guest Count")).toHaveValue("400"));
  });

  it("sends the linked lead and its prefilled details in the payload", async () => {
    render(<QuoteCreatePage />);
    openPicker();
    search("rimsha");
    fireEvent.click(screen.getByText("Rimsha Kiyani"));
    await waitFor(() => expect(screen.getByLabelText("Guest Count")).toHaveValue("80"));

    // A customer is required, and it's the same kind of picker.
    fireEvent.click(screen.getByLabelText("Customer"));
    fireEvent.click(screen.getByText("Jane Doe"));

    fireEvent.click(screen.getByText("Create Quote"));
    await waitFor(() => expect(h.createQuote).toHaveBeenCalledTimes(1));
    const payload = h.createQuote.mock.calls[0][0] as Record<string, unknown>;
    expect(payload.lead).toBe(13);
    expect(payload.guest_count).toBe(80);
    expect(payload.event_date).toBe("2026-10-01");
  });

  it("can be unlinked again after choosing", async () => {
    render(<QuoteCreatePage />);
    openPicker();
    fireEvent.click(screen.getByText("Rimsha Kiyani"));
    expect(screen.getByLabelText("Link to Lead")).toHaveTextContent("Rimsha Kiyani");

    openPicker();
    fireEvent.click(screen.getByText("-- No lead (standalone quote) --"));
    expect(screen.getByLabelText("Link to Lead")).toHaveTextContent("-- No lead (standalone quote) --");
  });
});
