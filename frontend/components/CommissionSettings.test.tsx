import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";

const mutate = vi.fn();

vi.mock("@/lib/hooks", () => ({
  useSiteSettings: () => ({
    data: {
      currency_symbol: "£",
      commission_model: "accelerated",
      commission_flat_rate: "5.00",
      target_period: "monthly",
      commission_basis: "event_date",
      commission_model_choices: [
        { value: "flat", label: "Flat rate" },
        { value: "accelerated", label: "Accelerated" },
      ],
      target_period_choices: [{ value: "monthly", label: "Monthly" }],
      commission_basis_choices: [
        { value: "event_date", label: "Event date" },
        { value: "booking_date", label: "Booking date" },
      ],
    },
    mutate,
  }),
  useCommissionBands: () => ({
    data: [{ id: 1, min_attainment_pct: "0.00", rate: "4.00" }],
    mutate,
  }),
  useSalesTargets: () => ({
    data: [{ id: 1, user: 7, user_name: "Rep One", amount: "5000000.00" }],
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
const createCommissionBand = vi.fn().mockResolvedValue({});
const setSalesTarget = vi.fn().mockResolvedValue({});
vi.mock("@/lib/api", () => ({
  api: {
    updateSiteSettings: (...a: unknown[]) => updateSiteSettings(...a),
    createCommissionBand: (...a: unknown[]) => createCommissionBand(...a),
    updateCommissionBand: vi.fn().mockResolvedValue({}),
    deleteCommissionBand: vi.fn().mockResolvedValue(undefined),
    setSalesTarget: (...a: unknown[]) => setSalesTarget(...a),
  },
}));

import CommissionSettings from "./CommissionSettings";

beforeEach(() => {
  updateSiteSettings.mockClear();
  createCommissionBand.mockClear();
  setSalesTarget.mockClear();
});

describe("CommissionSettings", () => {
  it("shows the accelerated bands section with the existing band", () => {
    render(<CommissionSettings />);
    expect(screen.getByText("Accelerated bands")).toBeInTheDocument();
    expect(screen.getByDisplayValue("4.00")).toBeInTheDocument(); // band rate
  });

  it("only lists salespeople in targets (not the owner)", () => {
    render(<CommissionSettings />);
    expect(screen.getByText("Rep One")).toBeInTheDocument();
    expect(screen.queryByText("Boss X")).not.toBeInTheDocument();
  });

  it("saves the model when changed", async () => {
    render(<CommissionSettings />);
    const selects = screen.getAllByRole("combobox");
    fireEvent.change(selects[0], { target: { value: "flat" } });
    await waitFor(() => expect(updateSiteSettings).toHaveBeenCalledWith({ commission_model: "flat" }));
  });

  it("adds a band", async () => {
    render(<CommissionSettings />);
    fireEvent.change(screen.getByLabelText("new threshold"), { target: { value: "100" } });
    fireEvent.change(screen.getByLabelText("new rate"), { target: { value: "7" } });
    fireEvent.click(screen.getByText("+ Add band"));
    await waitFor(() => expect(createCommissionBand).toHaveBeenCalledWith({ min_attainment_pct: "100", rate: "7" }));
  });

  it("sets a salesperson target on blur", async () => {
    render(<CommissionSettings />);
    const input = screen.getByLabelText("Rep target");
    fireEvent.change(input, { target: { value: "6000000" } });
    fireEvent.blur(input);
    await waitFor(() => expect(setSalesTarget).toHaveBeenCalledWith(7, "6000000"));
  });
});
