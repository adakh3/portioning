import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, screen } from "@testing-library/react";

let commissionReturn: { data: unknown; error: Error | null; isLoading: boolean };

vi.mock("@/lib/hooks", () => ({
  useMyCommission: () => commissionReturn,
  useSiteSettings: () => ({ data: { currency_symbol: "£" } }),
}));

import CommissionPage from "./page";

const FLAT_DATA = {
  period: "June 2026",
  period_unit: "monthly",
  period_start: "2026-06-01",
  period_end: "2026-07-01",
  model: "flat",
  revenue: "50000.00",
  target: "60000.00",
  attainment_pct: "83.33",
  commission: "2500.00",
  deals: 3,
  lifetime_revenue: "200000.00",
  lifetime_deals: 12,
  breakdown: [
    { from_pct: "0.00", to_pct: null, rate: "5.00", revenue_in_band: "50000.00", commission: "2500.00" },
  ],
};

const ACCEL_DATA = {
  ...FLAT_DATA,
  model: "accelerated",
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
  commissionReturn = { data: FLAT_DATA, error: null, isLoading: false };
});

describe("Commission page", () => {
  it("renders the heading, period and flat-rate badge", () => {
    render(<CommissionPage />);
    expect(screen.getByText("My Commission")).toBeInTheDocument();
    expect(screen.getByText(/June 2026 · 3 deals won/)).toBeInTheDocument();
    expect(screen.getByText("Flat rate")).toBeInTheDocument();
  });

  it("shows the commission earned, formatted", () => {
    render(<CommissionPage />);
    expect(screen.getByText("Commission earned")).toBeInTheDocument();
    expect(screen.getAllByText("£2,500.00").length).toBeGreaterThan(0);
  });

  it("renders the accelerated band breakdown", () => {
    commissionReturn = { data: ACCEL_DATA, error: null, isLoading: false };
    render(<CommissionPage />);
    expect(screen.getByText("Accelerated")).toBeInTheDocument();
    expect(screen.getByText("0% – 100%")).toBeInTheDocument();
    expect(screen.getByText("100%+")).toBeInTheDocument();
    expect(screen.getByText("7%")).toBeInTheDocument();
    // total commission appears (emphasis card + table total)
    expect(screen.getAllByText("£270,000.00").length).toBeGreaterThan(0);
  });

  it("shows a loading state", () => {
    commissionReturn = { data: undefined, error: null, isLoading: true };
    render(<CommissionPage />);
    expect(screen.getByText(/Loading commission/)).toBeInTheDocument();
  });

  it("shows an error state", () => {
    commissionReturn = { data: undefined, error: new Error("boom"), isLoading: false };
    render(<CommissionPage />);
    expect(screen.getByText(/Error: boom/)).toBeInTheDocument();
  });
});
