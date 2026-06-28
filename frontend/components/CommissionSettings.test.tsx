import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";

const mutate = vi.fn();
const mutateGrid = vi.fn();

vi.mock("@/lib/hooks", () => ({
  useSiteSettings: () => ({
    data: {
      currency_symbol: "£",
      target_period: "monthly",
      commission_basis: "event_date",
      commission_model_choices: [
        { value: "flat", label: "Flat rate" },
        { value: "accelerated", label: "Accelerated" },
      ],
      target_period_choices: [{ value: "monthly", label: "Monthly" }, { value: "quarterly", label: "Quarterly" }],
      commission_basis_choices: [{ value: "event_date", label: "Event date" }],
      fiscal_year_start_month: 1,
      fiscal_year_start_month_choices: [
        { value: 1, label: "January (calendar year)" },
        { value: 4, label: "April" },
      ],
    },
    mutate,
  }),
  useCommissionPlans: () => ({
    data: [
      { id: 1, name: "Default", commission_model: "flat", commission_flat_rate: "5.00", is_default: true },
      { id: 2, name: "Senior", commission_model: "accelerated", commission_flat_rate: "0.00", is_default: false },
    ],
    mutate,
  }),
  useCommissionBands: () => ({
    data: [{ id: 10, plan: 2, min_attainment_pct: "0.00", rate: "4.00" }],
    mutate,
  }),
  useSalesTargetGrid: () => ({
    data: {
      period_type: "monthly",
      fiscal_year: 2026,
      fiscal_year_label: "2026",
      fiscal_start_month: 1,
      columns: [{ index: 0, label: "Jan" }, { index: 1, label: "Feb" }],
      reps: [
        { user_id: 7, user_name: "Rep One", plan: null, cells: { 0: "5000000.00", 1: "6000000.00" }, total: "11000000.00" },
      ],
    },
    mutate: mutateGrid,
  }),
}));

const updateSiteSettings = vi.fn().mockResolvedValue({});
const createCommissionPlan = vi.fn().mockResolvedValue({});
const setRepPlan = vi.fn().mockResolvedValue({});
const setSalesTargetCell = vi.fn().mockResolvedValue({});
vi.mock("@/lib/api", () => ({
  api: {
    updateSiteSettings: (...a: unknown[]) => updateSiteSettings(...a),
    createCommissionPlan: (...a: unknown[]) => createCommissionPlan(...a),
    updateCommissionPlan: vi.fn().mockResolvedValue({}),
    deleteCommissionPlan: vi.fn().mockResolvedValue(undefined),
    createCommissionBand: vi.fn().mockResolvedValue({}),
    updateCommissionBand: vi.fn().mockResolvedValue({}),
    deleteCommissionBand: vi.fn().mockResolvedValue(undefined),
    setRepPlan: (...a: unknown[]) => setRepPlan(...a),
    setSalesTargetCell: (...a: unknown[]) => setSalesTargetCell(...a),
  },
}));

import CommissionSettings from "./CommissionSettings";

beforeEach(() => {
  updateSiteSettings.mockClear();
  createCommissionPlan.mockClear();
  setRepPlan.mockClear();
  setSalesTargetCell.mockClear();
  mutateGrid.mockClear();
});

describe("CommissionSettings (plans)", () => {
  it("lists plans and shows the accelerated plan's band", () => {
    render(<CommissionSettings />);
    expect(screen.getByLabelText("Default name")).toHaveValue("Default");
    expect(screen.getByLabelText("Senior name")).toHaveValue("Senior");
    expect(screen.getByLabelText("rate %")).toHaveValue(4); // Senior's band rate
  });

  it("shows the targets grid with the rep's period cells and annual total", () => {
    render(<CommissionSettings />);
    expect(screen.getByText("Rep One")).toBeInTheDocument();
    expect(screen.getByText("Jan")).toBeInTheDocument();           // period column
    expect(screen.getByText("Feb")).toBeInTheDocument();
    expect(screen.getByLabelText("Rep One Jan")).toHaveValue(5000000); // a cell
    expect(screen.getByText("2026")).toBeInTheDocument();          // fiscal-year label
    expect(screen.getAllByText("£11,000,000").length).toBeGreaterThan(0); // annual total
  });

  it("edits a target cell", async () => {
    render(<CommissionSettings />);
    const cell = screen.getByLabelText("Rep One Feb");
    fireEvent.change(cell, { target: { value: "7000000" } });
    fireEvent.blur(cell);
    await waitFor(() => expect(setSalesTargetCell).toHaveBeenCalledWith(7, 2026, 1, "7000000"));
  });

  it("creates a plan", async () => {
    render(<CommissionSettings />);
    fireEvent.change(screen.getByPlaceholderText(/New plan name/i), { target: { value: "Lead" } });
    fireEvent.click(screen.getByText("+ Add plan"));
    await waitFor(() => expect(createCommissionPlan).toHaveBeenCalledWith({
      name: "Lead", commission_model: "flat", commission_flat_rate: "0",
    }));
  });

  it("assigns a plan to a salesperson", async () => {
    render(<CommissionSettings />);
    fireEvent.change(screen.getByLabelText("Rep One plan"), { target: { value: "2" } });
    await waitFor(() => expect(setRepPlan).toHaveBeenCalledWith(7, 2));
  });

  it("saves the org-wide period and refetches the grid (its shape changed)", async () => {
    render(<CommissionSettings />);
    fireEvent.change(screen.getByLabelText("Target period"), { target: { value: "quarterly" } });
    await waitFor(() => expect(updateSiteSettings).toHaveBeenCalledWith({ target_period: "quarterly" }));
    // The grid's SWR key (fiscal year) doesn't change, so it must be revalidated explicitly.
    await waitFor(() => expect(mutateGrid).toHaveBeenCalled());
  });

  it("saves the financial year start as a number and refetches the grid", async () => {
    render(<CommissionSettings />);
    fireEvent.change(screen.getByLabelText("Financial year start month"), { target: { value: "4" } });
    await waitFor(() => expect(updateSiteSettings).toHaveBeenCalledWith({ fiscal_year_start_month: 4 }));
    await waitFor(() => expect(mutateGrid).toHaveBeenCalled());
  });
});
