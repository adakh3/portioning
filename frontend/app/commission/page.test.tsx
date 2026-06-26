import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, screen } from "@testing-library/react";

let commissionReturn: { data: unknown; error: Error | null; isLoading: boolean };

vi.mock("@/lib/hooks", () => ({
  useMyCommission: () => commissionReturn,
  useSiteSettings: () => ({ data: { currency_symbol: "£" } }),
}));

// Animation libs: render final values, no canvas in jsdom.
vi.mock("canvas-confetti", () => ({ default: vi.fn() }));
vi.mock("react-countup", () => ({
  default: ({ end, prefix = "", suffix = "", decimals = 0 }: { end: number; prefix?: string; suffix?: string; decimals?: number }) =>
    `${prefix}${Number(end).toLocaleString("en-US", { minimumFractionDigits: decimals, maximumFractionDigits: decimals })}${suffix}`,
}));

import MyTargetsPage from "./page";

const UNDER_TARGET = {
  period: "June 2026",
  period_unit: "monthly",
  period_start: "2026-06-01",
  period_end: "2026-07-01",
  model: "flat",
  plan: "Default",
  basis: "event_date",
  revenue: "50000.00",
  target: "60000.00",
  attainment_pct: "83.33",
  commission: "2500.00",
  deals: 3,
  year_label: "2026",
  year_revenue: "200000.00",
  year_deals: 12,
  breakdown: [
    { from_pct: "0.00", to_pct: null, rate: "5.00", revenue_in_band: "50000.00", commission: "2500.00" },
  ],
};

const OVER_TARGET = {
  ...UNDER_TARGET,
  model: "accelerated",
  plan: "Senior",
  revenue: "6000000.00",
  target: "5000000.00",
  attainment_pct: "120.00",
  commission: "270000.00",
  breakdown: [
    { from_pct: "0.00", to_pct: "100.00", rate: "4.00", revenue_in_band: "5000000.00", commission: "200000.00" },
    { from_pct: "100.00", to_pct: null, rate: "7.00", revenue_in_band: "1000000.00", commission: "70000.00" },
  ],
};

beforeEach(() => {
  commissionReturn = { data: UNDER_TARGET, error: null, isLoading: false };
});

describe("My Targets page", () => {
  it("leads with the target — heading, period and attainment", () => {
    render(<MyTargetsPage />);
    expect(screen.getByText("My Targets")).toBeInTheDocument();
    expect(screen.getByText("June 2026")).toBeInTheDocument();
    expect(screen.getByText("83.3%")).toBeInTheDocument(); // attainment
    expect(screen.getByText(/£10,000\.00 to go/)).toBeInTheDocument(); // under target
  });

  it("mentions the commission earned", () => {
    render(<MyTargetsPage />);
    expect(screen.getByText("Commission earned")).toBeInTheDocument();
    expect(screen.getAllByText("£2,500.00").length).toBeGreaterThan(0);
  });

  it("shows over-achievement when past target", () => {
    commissionReturn = { data: OVER_TARGET, error: null, isLoading: false };
    render(<MyTargetsPage />);
    expect(screen.getByText("120%")).toBeInTheDocument();
    expect(screen.getByText(/20% over target/)).toBeInTheDocument();
    expect(screen.getByText(/£1,000,000\.00 over target/)).toBeInTheDocument();
    expect(screen.getByText("Senior")).toBeInTheDocument(); // plan badge
    expect(screen.getAllByText("£270,000.00").length).toBeGreaterThan(0);
  });

  it("shows the year-to-date card with the org's year label", () => {
    render(<MyTargetsPage />);
    expect(screen.getByText("This year")).toBeInTheDocument();
    expect(screen.getByText("2026")).toBeInTheDocument(); // year_label
    expect(screen.getByText("£200,000.00")).toBeInTheDocument(); // year_revenue
    expect(screen.getByText("12")).toBeInTheDocument(); // year_deals
  });

  it("shows a loading state", () => {
    commissionReturn = { data: undefined, error: null, isLoading: true };
    render(<MyTargetsPage />);
    expect(screen.getByText(/Loading/)).toBeInTheDocument();
  });

  it("shows an error state", () => {
    commissionReturn = { data: undefined, error: new Error("boom"), isLoading: false };
    render(<MyTargetsPage />);
    expect(screen.getByText(/Error: boom/)).toBeInTheDocument();
  });
});
