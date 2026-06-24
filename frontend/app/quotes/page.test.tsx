import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";

const push = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ push }) }));
vi.mock("@/lib/useQueryState", () => ({ useQueryState: (_k: string, d: string) => [d, vi.fn()] }));

const QUOTES = [
  { id: 10, version: 1, status: "draft", status_display: "Draft", contact_name: "Zara", account_name: "", contact_email: "", contact_phone: "", venue_name: "", event_date: "2026-09-01", guest_count: 100, total: "5000.00", created_at: "2026-06-02", created_by: 1, created_by_name: "Rep One", product: null, event_type: "" },
  { id: 11, version: 2, status: "sent", status_display: "Sent", contact_name: "Adam", account_name: "", contact_email: "", contact_phone: "", venue_name: "", event_date: "2026-08-01", guest_count: 50, total: "9000.00", created_at: "2026-06-01", created_by: 2, created_by_name: "Rep Two", product: null, event_type: "" },
];

vi.mock("@/lib/hooks", () => ({
  useQuotes: () => ({ data: QUOTES, error: null, isLoading: false }),
  useSiteSettings: () => ({ data: { currency_symbol: "£", currency_code: "GBP", date_format: "DD/MM/YYYY" } }),
  useDateFormat: () => "DD/MM/YYYY",
  useUsers: () => ({ data: [] }),
  useProductLines: () => ({ data: [] }),
  useEventTypes: () => ({ data: [] }),
}));

import QuotesPage from "./page";

describe("Quotes table", () => {
  beforeEach(() => push.mockClear());

  it("renders quotes in a table by customer (not quote id)", () => {
    render(<QuotesPage />);
    expect(screen.getByText("Customer")).toBeTruthy();
    expect(screen.getByText("Zara")).toBeTruthy();
    expect(screen.getByText("Adam")).toBeTruthy();
    // quote id is shown as a secondary reference, not the primary identifier
    expect(screen.getByText("#10 · v1")).toBeTruthy();
    // salesperson (creator) column
    expect(screen.getByText("Rep One")).toBeTruthy();
    expect(screen.getByText("Rep Two")).toBeTruthy();
  });

  it("navigates to the quote on row click", () => {
    render(<QuotesPage />);
    fireEvent.click(screen.getByText("Zara"));
    expect(push).toHaveBeenCalledWith("/quotes/10");
  });

  it("sorts by customer when the header is clicked", () => {
    render(<QuotesPage />);
    // default sort = created_at desc → Zara (2026-06-02) before Adam (2026-06-01)
    let names = screen.getAllByText(/^(Zara|Adam)$/).map((e) => e.textContent);
    expect(names[0]).toBe("Zara");
    fireEvent.click(screen.getByText(/^Customer/));
    names = screen.getAllByText(/^(Zara|Adam)$/).map((e) => e.textContent);
    expect(names[0]).toBe("Adam"); // alphabetical asc
  });
});
