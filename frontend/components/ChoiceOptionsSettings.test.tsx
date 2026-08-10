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

  it("patches optimistically — the cache gets the new value before the API answers", async () => {
    // The row's controls are bound to the SWR data, so without this write the
    // clicked value visibly reverted for the whole PATCH round-trip — on
    // production latency that read as "the checkbox doesn't work" (2026-08-10).
    mutate.mockClear();
    renderIt();
    fireEvent.click(screen.getAllByText("Active")[0]);
    expect(mutate).toHaveBeenCalledWith(
      [{ ...data[0], is_active: false }, data[1]],
      { revalidate: false },
    );
    expect(mutate.mock.invocationCallOrder[0]).toBeLessThan(
      updateChoiceOption.mock.invocationCallOrder[0],
    );
    await waitFor(() => expect(updateChoiceOption).toHaveBeenCalledWith(BASE, 1, { is_active: false }));
  });

  // `renderExtra` is how a list that carries more than a label gets its controls —
  // the timeline steps' standard-day placement, and now the service styles'
  // "Guests choose" (REL-452). Both depend on it patching the RIGHT row.
  it("renders the extra control once per row and patches that row's id", async () => {
    render(
      <ChoiceOptionsSettings
        title="Service Styles" base={BASE} swrKey="managed-sources" revalidateKey="sources"
        extraHeader={<span>Guests choose</span>}
        renderExtra={(o, patch) => (
          <button type="button" onClick={() => patch({ guests_choose: true })}>
            {`extra-${o.label}`}
          </button>
        )}
      />,
    );
    expect(screen.getByText("Guests choose")).toBeTruthy();
    expect(screen.getByText("extra-Website")).toBeTruthy();
    expect(screen.getByText("extra-Referral")).toBeTruthy();

    fireEvent.click(screen.getByText("extra-Referral"));
    await waitFor(() =>
      expect(updateChoiceOption).toHaveBeenCalledWith(BASE, 2, { guests_choose: true }));
  });

  it("omits the extras column entirely when a list has none", () => {
    renderIt();
    expect(screen.queryByText("Guests choose")).toBeNull();
  });
});
