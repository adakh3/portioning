import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";

const mutate = vi.fn();

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
  useSalesTargets: () => ({
    data: [{ id: 1, user: 7, user_name: "Rep One", plan: null, amount: "5000000.00" }],
    mutate,
  }),
  useUsers: () => ({
    data: [
      { id: 7, first_name: "Rep", last_name: "One", role: "salesperson" },
      { id: 8, first_name: "Boss", last_name: "X", role: "owner" },
    ],
  }),
}));

const updateSiteSettings = vi.fn().mockResolvedValue({});
const createCommissionPlan = vi.fn().mockResolvedValue({});
const setSalesTarget = vi.fn().mockResolvedValue({});
vi.mock("@/lib/api", () => ({
  api: {
    updateSiteSettings: (...a: unknown[]) => updateSiteSettings(...a),
    createCommissionPlan: (...a: unknown[]) => createCommissionPlan(...a),
    updateCommissionPlan: vi.fn().mockResolvedValue({}),
    deleteCommissionPlan: vi.fn().mockResolvedValue(undefined),
    createCommissionBand: vi.fn().mockResolvedValue({}),
    updateCommissionBand: vi.fn().mockResolvedValue({}),
    deleteCommissionBand: vi.fn().mockResolvedValue(undefined),
    setSalesTarget: (...a: unknown[]) => setSalesTarget(...a),
  },
}));

import CommissionSettings from "./CommissionSettings";

beforeEach(() => {
  updateSiteSettings.mockClear();
  createCommissionPlan.mockClear();
  setSalesTarget.mockClear();
});

describe("CommissionSettings (plans)", () => {
  it("lists plans and shows the accelerated plan's band", () => {
    render(<CommissionSettings />);
    expect(screen.getByLabelText("Default name")).toHaveValue("Default");
    expect(screen.getByLabelText("Senior name")).toHaveValue("Senior");
    expect(screen.getByLabelText("rate %")).toHaveValue(4); // Senior's band rate
  });

  it("only lists salespeople (not the owner)", () => {
    render(<CommissionSettings />);
    expect(screen.getByText("Rep One")).toBeInTheDocument();
    expect(screen.queryByText("Boss X")).not.toBeInTheDocument();
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
    fireEvent.change(screen.getByLabelText("Rep plan"), { target: { value: "2" } });
    await waitFor(() => expect(setSalesTarget).toHaveBeenCalledWith(7, { plan: 2 }));
  });

  it("saves the org-wide period", async () => {
    render(<CommissionSettings />);
    fireEvent.change(screen.getByLabelText("Target period"), { target: { value: "quarterly" } });
    await waitFor(() => expect(updateSiteSettings).toHaveBeenCalledWith({ target_period: "quarterly" }));
  });
});
