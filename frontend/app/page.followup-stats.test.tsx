import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";

let mockUser: { id: number; role: string };
vi.mock("@/lib/auth", () => ({ useAuth: () => ({ user: mockUser }) }));
vi.mock("@/components/MyTargetsPanel", () => ({ default: () => null }));

const STATS = {
  to_review: 3,
  due: 9,
  sent: 12,
  breakdown: [
    { user_id: 5, name: "Arsalan Khan", to_review: 2, due: 5, sent: 8 },
    { user_id: 6, name: "Awais Tahir", to_review: 1, due: 4, sent: 4 },
    { user_id: 7, name: "Idle Ivan", to_review: 0, due: 0, sent: 0 },
  ],
};

const useFollowUpStats = vi.fn(() => ({ data: STATS }));
const MY_STATS = {
  kpis: { total_active: 1, conversion_rate: 10, avg_days_to_convert: 2, unread_whatsapp_leads: 0 },
  pipeline_value: "0",
  status_distribution: [],
};
vi.mock("@/lib/hooks", () => ({
  useDashboardStats: () => ({ data: undefined }),
  useMyDashboardStats: () => ({ data: MY_STATS }),
  useSiteSettings: () => ({ data: undefined }),
  useDateFormat: () => "DD/MM/YYYY",
  useReminderCounts: () => ({ data: undefined }),
  useEvents: () => ({ data: [] }),
  useQuotes: () => ({ data: [] }),
  useLeads: () => ({ data: [] }),
  useFollowUpStats: (p: string, f?: string, t?: string) => useFollowUpStats(p, f, t),
}));
vi.mock("@/lib/api", () => ({ api: {} }));

import Dashboard from "./page";

describe("Dashboard follow-up stats", () => {
  beforeEach(() => useFollowUpStats.mockClear());

  it("shows team tiles + per-rep rows for a manager, hiding all-zero reps", () => {
    mockUser = { id: 1, role: "owner" };
    render(<Dashboard />);
    expect(screen.getByText("Follow-ups to review")).toBeTruthy();
    expect(screen.getByText("Leads due a follow-up")).toBeTruthy();
    expect(screen.getByText("9")).toBeTruthy();
    expect(screen.getByText("Follow-ups by person")).toBeTruthy();
    expect(screen.getByText("Arsalan Khan")).toBeTruthy();
    expect(screen.getByText("2 to review · 5 due · 8 sent")).toBeTruthy();
    expect(screen.queryByText("Idle Ivan")).toBeNull();
    // Managers request the dashboard's selected window (default all-time).
    expect(useFollowUpStats).toHaveBeenCalledWith("all", undefined, undefined);
  });

  it("follows the dashboard period picker", () => {
    mockUser = { id: 1, role: "owner" };
    render(<Dashboard />);
    fireEvent.click(screen.getByRole("button", { name: "This Week" }));
    expect(useFollowUpStats).toHaveBeenLastCalledWith("week", undefined, undefined);
  });

  it("shows a rep their own tiles (30-day window) without the breakdown", () => {
    mockUser = { id: 5, role: "salesperson" };
    useFollowUpStats.mockReturnValue({ data: { to_review: 1, due: 4, sent: 2 } });
    render(<Dashboard />);
    expect(screen.getByText("Follow-ups to review")).toBeTruthy();
    expect(screen.getByText("last 30 days")).toBeTruthy();
    expect(screen.queryByText("Follow-ups by person")).toBeNull();
    expect(useFollowUpStats).toHaveBeenCalledWith("month", undefined, undefined);
  });
});
