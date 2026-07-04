import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";

import { todayISO } from "@/lib/dateFormat";

// These integration tests render the REAL quote create page and drive it through
// the UI, asserting the payload that reaches api.createQuote. They exist to catch
// the class of wiring/payload bugs that only surfaced in manual testing:
//   - the gents/ladies guest split not reaching the payload,
//   - timeline times not anchored/saved,
//   - additional meals (blank label) not saved.
const h = vi.hoisted(() => ({ createQuote: vi.fn(), push: vi.fn() }));

vi.mock("next/navigation", () => ({
  useParams: () => ({ id: "new" }),
  useRouter: () => ({ push: h.push }),
}));

// Stub MenuBuilder (and thus the meal's inner menu) so we don't pull its data hooks.
vi.mock("@/components/MenuBuilder", () => ({ default: () => null }));

vi.mock("@/lib/hooks", () => ({
  useQuote: () => ({ data: null, error: null, isLoading: false, mutate: vi.fn() }),
  useAccounts: () => ({ data: [] }),
  useContacts: () => ({ data: [{ id: 3, name: "Jane Doe", phone: "", account: null }] }),
  useAddOnProducts: () => ({ data: [] }),
  useVenues: () => ({ data: [] }),
  useSiteSettings: () => ({ data: { currency_symbol: "£", currency_code: "GBP", date_format: "DD/MM/YYYY", price_rounding_step: "50", default_tax_rate: "0.2000" } }),
  useDateFormat: () => "DD/MM/YYYY",
  useEventTypes: () => ({ data: [{ id: 1, value: "wedding", label: "Wedding" }] }),
  useServiceStyles: () => ({ data: [] }),
  useMealTypes: () => ({ data: [] }),
  useAllLeads: () => ({ data: [] }),
  useProductLines: () => ({ data: [{ id: 5, name: "Catering", is_active: true, colour: "#000", round_robin_index: 0 }] }),
  revalidate: vi.fn(),
}));

vi.mock("@/lib/api", () => ({
  api: {
    createQuote: (...args: unknown[]) => { h.createQuote(...args); return Promise.resolve({ id: 99 }); },
    getAccount: () => Promise.resolve({ contacts: [] }),
  },
}));

import QuoteCreatePage from "./page";

describe("Quote create — guest split, timeline, meals reach the payload", () => {
  beforeEach(() => { h.createQuote.mockClear(); h.push.mockClear(); });

  it("sends the gents/ladies split, an anchored timeline time, and an additional meal", async () => {
    const today = todayISO();
    render(<QuoteCreatePage />);

    // 1) Total guests → auto 50/50 split (the guest_count→gents/ladies bug).
    fireEvent.change(screen.getByLabelText("Total Guests"), { target: { value: "40" } });

    // 2) A timeline time → anchored to the (defaulted-to-today) event date.
    fireEvent.click(screen.getByLabelText("Set Setup Time"));
    fireEvent.change(screen.getByLabelText("Setup Time hour"), { target: { value: "10" } });
    fireEvent.change(screen.getByLabelText("Setup Time minute"), { target: { value: "00" } });

    // 3) An additional meal with a blank label + its own time.
    fireEvent.click(screen.getByText("+ Add Meal"));
    fireEvent.click(await screen.findByLabelText("Set Additional meal time"));
    fireEvent.change(screen.getByLabelText("Additional meal time hour"), { target: { value: "14" } });
    fireEvent.change(screen.getByLabelText("Additional meal time minute"), { target: { value: "00" } });

    fireEvent.click(screen.getByText("Create Quote"));

    await waitFor(() => expect(h.createQuote).toHaveBeenCalledTimes(1));
    const payload = h.createQuote.mock.calls[0][0] as Record<string, unknown>;

    // Guest split
    expect(payload.gents).toBe(20);
    expect(payload.ladies).toBe(20);
    expect(payload.guest_count).toBe(40);
    // Event date defaults to today (not empty → no "wrong format")
    expect(payload.event_date).toBe(today);
    // Timeline time anchored to the event date
    expect(payload.setup_time).toBe(`${today}T10:00`);
    // Product defaults to the org's first active line
    expect(payload.product).toBe(5);
    // Meal: inherits total guests, blank label allowed, time anchored
    expect(payload.additional_meals).toEqual([
      expect.objectContaining({ guest_count: 40, label: "", meal_time: `${today}T14:00` }),
    ]);
  });
});
