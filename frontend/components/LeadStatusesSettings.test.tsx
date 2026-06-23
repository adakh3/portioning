import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";

const mutate = vi.fn();
vi.mock("@/lib/hooks", () => ({
  useManagedLeadStatuses: () => ({
    data: [
      { id: 1, value: "new", label: "New", sort_order: 0, is_active: true, color: "blue", is_default: true, is_won: false, is_lost: false },
      { id: 2, value: "won", label: "Won", sort_order: 1, is_active: true, color: "green", is_default: false, is_won: true, is_lost: false },
    ],
    mutate,
    isLoading: false,
  }),
  revalidate: vi.fn(),
}));

const createLeadStatus = vi.fn().mockResolvedValue({});
const updateLeadStatus = vi.fn().mockResolvedValue({});
const deleteLeadStatus = vi.fn().mockResolvedValue(undefined);
vi.mock("@/lib/api", () => ({
  api: {
    createLeadStatus: (...a: unknown[]) => createLeadStatus(...a),
    updateLeadStatus: (...a: unknown[]) => updateLeadStatus(...a),
    deleteLeadStatus: (...a: unknown[]) => deleteLeadStatus(...a),
  },
}));

import LeadStatusesSettings from "./LeadStatusesSettings";

describe("LeadStatusesSettings", () => {
  it("lists existing statuses as editable labels", () => {
    render(<LeadStatusesSettings />);
    expect(screen.getByDisplayValue("New")).toBeTruthy();
    expect(screen.getByDisplayValue("Won")).toBeTruthy();
  });

  it("adds a new status via the API", async () => {
    render(<LeadStatusesSettings />);
    fireEvent.change(screen.getByPlaceholderText(/New status name/), { target: { value: "Site Visit" } });
    fireEvent.click(screen.getByText("+ Add status"));
    await waitFor(() => expect(createLeadStatus).toHaveBeenCalled());
    expect(createLeadStatus.mock.calls[0][0]).toMatchObject({ label: "Site Visit" });
  });

  it("renaming a label saves on blur, keeping the row's value", async () => {
    render(<LeadStatusesSettings />);
    const input = screen.getByDisplayValue("Won");
    fireEvent.change(input, { target: { value: "Closed Won" } });
    fireEvent.blur(input);
    await waitFor(() => expect(updateLeadStatus).toHaveBeenCalledWith(2, { label: "Closed Won" }));
  });
});
