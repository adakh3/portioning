import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";

const switchOrg = vi.fn().mockResolvedValue(undefined);
let mockUser: Record<string, unknown> | null;
vi.mock("@/lib/auth", () => ({
  useAuth: () => ({ user: mockUser, switchOrg }),
}));

const getOrganisations = vi.fn().mockResolvedValue([
  { id: 1, name: "Hanif Rajput" },
  { id: 2, name: "Rajput Catering" },
]);
vi.mock("@/lib/api", () => ({
  api: { getOrganisations: () => getOrganisations() },
}));

import OrgSwitcher from "./OrgSwitcher";

describe("OrgSwitcher", () => {
  beforeEach(() => { switchOrg.mockClear(); });

  it("renders nothing for a non-superuser", () => {
    mockUser = { is_superuser: false, role: "owner", organisation: { id: 1, name: "Hanif Rajput" } };
    const { container } = render(<OrgSwitcher />);
    expect(container.firstChild).toBeNull();
  });

  it("shows the active org and switches on selection", async () => {
    mockUser = { is_superuser: true, all_orgs: false, organisation: { id: 1, name: "Hanif Rajput" } };
    render(<OrgSwitcher />);
    // current org shown on the trigger
    expect(screen.getByText("Hanif Rajput")).toBeTruthy();
    // open the menu (orgs load async)
    fireEvent.click(screen.getByTitle(/switch the org/i));
    await waitFor(() => expect(screen.getByText("Rajput Catering")).toBeTruthy());
    fireEvent.click(screen.getByText("Rajput Catering"));
    await waitFor(() => expect(switchOrg).toHaveBeenCalledWith(2));
  });

  it("never offers an all-orgs option (one org at a time)", async () => {
    mockUser = { is_superuser: true, all_orgs: false, organisation: null };
    render(<OrgSwitcher />);
    expect(screen.getByText("Pick an org")).toBeTruthy(); // no active org yet
    fireEvent.click(screen.getByTitle(/switch the org/i));
    expect(screen.queryByText("All orgs")).toBeNull();
    expect(screen.queryByText("My own org")).toBeNull();
    fireEvent.click(await screen.findByText("Hanif Rajput"));
    await waitFor(() => expect(switchOrg).toHaveBeenCalledWith(1));
  });
});
