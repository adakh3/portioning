import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";

let mockUser: { id: number; role: string } | null;
vi.mock("@/lib/auth", () => ({ useAuth: () => ({ user: mockUser }) }));

const REMINDERS = [
  { id: 1, lead: 10, lead_name: "Cust A", user: 2, user_name: "Rep A", due_at: "2999-01-01T09:00:00Z", note: "Call A", status: "pending", snoozed_until: null, completed_at: null, created_by: 1, created_by_name: "Admin", created_at: "2026-01-01T00:00:00Z" },
];
const USERS = [
  { id: 2, first_name: "Rep", last_name: "A", email: "repa@x.com", role: "salesperson" },
  { id: 3, first_name: "Rep", last_name: "B", email: "repb@x.com", role: "salesperson" },
];

const useReminders = vi.fn((_p?: unknown) => ({ data: REMINDERS, mutate: vi.fn() }));
vi.mock("@/lib/hooks", () => ({
  useReminders: (p: unknown) => useReminders(p),
  useUsers: () => ({ data: USERS }),
  useFollowUpDrafts: () => ({ data: [], mutate: vi.fn() }),
  useDateFormat: () => "DD/MM/YYYY",
  revalidate: vi.fn(),
}));

vi.mock("@/lib/api", () => ({ api: { updateReminder: vi.fn().mockResolvedValue({}) } }));

import FollowUpsPage from "./page";

describe("FollowUpsPage", () => {
  beforeEach(() => useReminders.mockClear());

  it("hides the person filter for a salesperson and requests their own scope", () => {
    mockUser = { id: 2, role: "salesperson" };
    render(<FollowUpsPage />);
    expect(screen.queryByLabelText("Filter follow-ups by person")).toBeNull();
    // Salespeople never pass a user filter — the backend forces their own.
    expect(useReminders).toHaveBeenLastCalledWith({ status: "pending", user: undefined });
  });

  it("shows a team view + person filter for an admin", () => {
    mockUser = { id: 1, role: "admin" };
    render(<FollowUpsPage />);
    // Team view shows the assignee on each card (the "·" separator is unique to it).
    expect(screen.getByText(/· Rep A/)).toBeTruthy();
    const select = screen.getByLabelText("Filter follow-ups by person") as HTMLSelectElement;
    expect(select).toBeTruthy();
  });

  it("passes the selected person as the user filter", () => {
    mockUser = { id: 1, role: "admin" };
    render(<FollowUpsPage />);
    const select = screen.getByLabelText("Filter follow-ups by person") as HTMLSelectElement;
    fireEvent.change(select, { target: { value: "3" } });
    expect(useReminders).toHaveBeenLastCalledWith({ status: "pending", user: "3" });
  });
});
