import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";

import type { ChoiceOption } from "@/lib/api";

// REL-452 — "Guests choose" belongs to Service Styles and to nothing else. The
// checkbox is passed down as `renderExtra`, so the failure this pins is a wiring
// one: handing it to the wrong list, or forgetting it entirely, which would leave
// the flag settable only through the API.
vi.mock("@/lib/auth", () => ({ useAuth: () => ({ user: { id: 1, role: "owner" } }) }));
vi.mock("@/lib/useQueryState", () => ({ useQueryState: () => ["options", vi.fn()] }));
// One stable object: a fresh `{}` per call makes the settings effect re-fire on
// every render, which spins the page until the worker runs out of memory.
const SETTINGS = { currency_symbol: "$", currency_code: "USD", date_format: "MM/DD/YYYY" };
vi.mock("@/lib/hooks", () => ({
  useSiteSettings: () => ({ data: SETTINGS, isLoading: false, mutate: vi.fn() }),
}));
vi.mock("@/lib/api", () => ({ api: { updateSiteSettings: vi.fn() } }));
// The other tabs' panels are irrelevant here and pull in their own data hooks.
vi.mock("@/components/LeadStatusesSettings", () => ({ default: () => null }));
vi.mock("@/components/ProductLinesSettings", () => ({ default: () => null }));
vi.mock("@/components/CommissionSettings", () => ({ default: () => null }));
vi.mock("@/components/BillingPanel", () => ({ default: () => null }));

// Stand in for the shared editor and report, per list, whether it was given the
// extra control — and render it against a real option so the label comes through.
const OPTION: ChoiceOption = {
  id: 3, value: "dropoff", label: "Drop-off / Delivery", sort_order: 5, is_active: true,
};
vi.mock("@/components/ChoiceOptionsSettings", () => ({
  default: ({ title, renderExtra }: {
    title: string;
    renderExtra?: (o: ChoiceOption, patch: (d: Partial<ChoiceOption>) => void) => React.ReactNode;
  }) => (
    <div data-testid={`list-${title}`}>
      <span>{title}</span>
      {renderExtra ? <span>{renderExtra(OPTION, () => {})}</span> : <span>no-extras</span>}
    </div>
  ),
}));

import SettingsPage from "./page";

describe("Settings → Service Styles carries the guests-choose flag", () => {
  it("gives the service-style rows a Guests choose checkbox", () => {
    render(<SettingsPage />);
    const list = screen.getByTestId("list-Service Styles");
    expect(list).toHaveTextContent("Service Styles");
    expect(
      screen.getByLabelText("Guests choose between dishes on Drop-off / Delivery"),
    ).toBeInTheDocument();
  });

  it("leaves the other choice lists alone", () => {
    // Event types and meal types have no behaviour attached to them — a stray
    // checkbox there would imply one.
    render(<SettingsPage />);
    expect(screen.getByTestId("list-Meal Types")).toHaveTextContent("no-extras");
    expect(screen.getByTestId("list-Event Types")).toHaveTextContent("no-extras");
    expect(screen.getByTestId("list-Lost Reasons")).toHaveTextContent("no-extras");
  });
});
