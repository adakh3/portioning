import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";

const mutate = vi.fn();
const data = [
  { id: 1, value: "website", label: "Website", sort_order: 0, is_active: true },
  { id: 2, value: "referral", label: "Referral", sort_order: 1, is_active: true },
];
vi.mock("@/lib/hooks", () => ({
  useManagedChoices: () => ({ data, mutate, isLoading: false }),
  revalidate: vi.fn(),
}));

const createChoiceOption = vi.fn().mockResolvedValue({});
const updateChoiceOption = vi.fn().mockResolvedValue({});
const deleteChoiceOption = vi.fn().mockResolvedValue(undefined);
vi.mock("@/lib/api", () => ({
  api: {
    createChoiceOption: (...a: unknown[]) => createChoiceOption(...a),
    updateChoiceOption: (...a: unknown[]) => updateChoiceOption(...a),
    deleteChoiceOption: (...a: unknown[]) => deleteChoiceOption(...a),
  },
}));

import ChoiceOptionsSettings from "./ChoiceOptionsSettings";

const BASE = "/bookings/settings/sources/";
function renderIt() {
  return render(
    <ChoiceOptionsSettings title="Lead Sources" base={BASE} swrKey="managed-sources" revalidateKey="sources" />,
  );
}

describe("ChoiceOptionsSettings", () => {
  beforeEach(() => { createChoiceOption.mockClear(); updateChoiceOption.mockClear(); });

  it("lists existing options", () => {
    renderIt();
    expect(screen.getByDisplayValue("Website")).toBeTruthy();
    expect(screen.getByDisplayValue("Referral")).toBeTruthy();
  });

  it("adds an option via the endpoint base", async () => {
    renderIt();
    fireEvent.change(screen.getByPlaceholderText(/New option/i), { target: { value: "Instagram" } });
    fireEvent.click(screen.getByText("+ Add"));
    await waitFor(() => expect(createChoiceOption).toHaveBeenCalled());
    expect(createChoiceOption.mock.calls[0][0]).toBe(BASE);
    expect(createChoiceOption.mock.calls[0][1]).toMatchObject({ label: "Instagram" });
  });

  it("renames on blur with the row id", async () => {
    renderIt();
    const input = screen.getByDisplayValue("Referral");
    fireEvent.change(input, { target: { value: "Word of mouth" } });
    fireEvent.blur(input);
    await waitFor(() => expect(updateChoiceOption).toHaveBeenCalledWith(BASE, 2, { label: "Word of mouth" }));
  });
});
