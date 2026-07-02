import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";

import { todayISO } from "@/lib/dateFormat";

// Integration test for the EVENT create page — the same guest-split + timeline
// wiring as quotes (shared components), asserted end-to-end into api.createEvent.
const h = vi.hoisted(() => ({ createEvent: vi.fn(), push: vi.fn() }));

vi.mock("next/navigation", () => ({
  useParams: () => ({ id: "new" }),
  useRouter: () => ({ push: h.push }),
  useSearchParams: () => ({ get: () => null }),
}));

vi.mock("@/components/MenuBuilder", () => ({ default: () => null }));
vi.mock("@/components/DealWonDialog", () => ({ default: () => null }));
// Stub the customer picker: one click selects contact 3 (event save requires it).
vi.mock("@/components/CustomerSelect", () => ({
  default: ({ onChange }: { onChange: (v: string) => void }) => (
    <button type="button" onClick={() => onChange("3")}>select-customer</button>
  ),
}));

vi.mock("@/lib/hooks", () => ({
  useEvent: () => ({ data: null, error: null, isLoading: false, mutate: vi.fn() }),
  useAccounts: () => ({ data: [] }),
  useContacts: () => ({ data: [{ id: 3, name: "Jane Doe", phone: "", account: null }] }),
  useVenues: () => ({ data: [] }),
  useAddOnProducts: () => ({ data: [] }),
  useLaborRoles: () => ({ data: [] }),
  useStaff: () => ({ data: [] }),
  useUsers: () => ({ data: [] }),
  useSiteSettings: () => ({ data: { currency_symbol: "£", currency_code: "GBP", date_format: "DD/MM/YYYY", price_rounding_step: "50", default_tax_rate: "0.2000" } }),
  useDateFormat: () => "DD/MM/YYYY",
  useEventTypes: () => ({ data: [{ id: 1, value: "wedding", label: "Wedding" }] }),
  useServiceStyles: () => ({ data: [] }),
  useMealTypes: () => ({ data: [] }),
}));

vi.mock("@/lib/api", () => ({
  api: {
    createEvent: (...args: unknown[]) => { h.createEvent(...args); return Promise.resolve({ id: 55 }); },
  },
}));

import EventCreatePage from "./page";

describe("Event create — guest split + anchored timeline reach the payload", () => {
  beforeEach(() => { h.createEvent.mockClear(); h.push.mockClear(); });

  it("sends the gents/ladies split and a timeline time anchored to the event date", async () => {
    const today = todayISO();
    render(<EventCreatePage />);

    fireEvent.click(screen.getByText("select-customer"));  // event save requires a customer
    fireEvent.change(screen.getByLabelText("Total Guests"), { target: { value: "40" } });
    fireEvent.change(screen.getByLabelText("Setup Time"), { target: { value: "10:00" } });

    fireEvent.click(screen.getByText("Create Event"));

    await waitFor(() => expect(h.createEvent).toHaveBeenCalledTimes(1));
    const payload = h.createEvent.mock.calls[0][0] as Record<string, unknown>;
    expect(payload.gents).toBe(20);
    expect(payload.ladies).toBe(20);
    expect(payload.date).toBe(today);              // defaults to today
    expect(payload.setup_time).toBe(`${today}T10:00`);
  });
});
