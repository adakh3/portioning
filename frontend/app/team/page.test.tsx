import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";

const replace = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ replace, push: vi.fn() }) }));

let mockUser: { id: number; role: string; is_superuser?: boolean } | null;
vi.mock("@/lib/auth", () => ({ useAuth: () => ({ user: mockUser }) }));
vi.mock("@/lib/hooks", () => ({ useProductLines: () => ({ data: [] }) }));

const TEAM = [
  { id: 1, first_name: "Olivia", last_name: "Owner", email: "owner@x.com", role: "owner", is_active: true, product_lines: [], product_line_names: [] },
  { id: 2, first_name: "Sam", last_name: "Sales", email: "sam@x.com", role: "salesperson", is_active: true, product_lines: [], product_line_names: [] },
];
const getOrgUsers = vi.fn().mockResolvedValue(TEAM);
vi.mock("@/lib/api", () => ({
  api: {
    getOrgUsers: () => getOrgUsers(),
    updateUser: vi.fn().mockResolvedValue({}),
    createUser: vi.fn().mockResolvedValue({}),
  },
}));

import TeamPage from "./page";

describe("TeamPage", () => {
  beforeEach(() => { replace.mockClear(); getOrgUsers.mockClear(); });

  it("loads and shows the team for an owner (no empty first view)", async () => {
    mockUser = { id: 1, role: "owner" };
    render(<TeamPage />);
    expect(await screen.findByText("owner@x.com")).toBeTruthy();
    expect(screen.getByText("sam@x.com")).toBeTruthy();
    expect(getOrgUsers).toHaveBeenCalled();
  });

  it("does not fetch and redirects a manager away", async () => {
    mockUser = { id: 9, role: "manager" };
    render(<TeamPage />);
    await waitFor(() => expect(replace).toHaveBeenCalledWith("/"));
    expect(getOrgUsers).not.toHaveBeenCalled();
  });

  it("disables editing the owner for an admin (owner protection)", async () => {
    mockUser = { id: 5, role: "admin" };
    render(<TeamPage />);
    await screen.findByText("owner@x.com");
    const editButtons = screen.getAllByRole("button", { name: "Edit" });
    // First row is the owner → its Edit is disabled; the salesperson row's is not.
    expect((editButtons[0] as HTMLButtonElement).disabled).toBe(true);
    expect((editButtons[1] as HTMLButtonElement).disabled).toBe(false);
  });

  it("allows editing the owner for the owner", async () => {
    mockUser = { id: 1, role: "owner" };
    render(<TeamPage />);
    await screen.findByText("owner@x.com");
    const editButtons = screen.getAllByRole("button", { name: "Edit" });
    expect((editButtons[0] as HTMLButtonElement).disabled).toBe(false);
  });
});
