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

const PREVIEW = {
  configured: true,
  first_gap_days: 3,
  leads: [
    { id: 10, contact_name: "Quiet Lead", days_stale: 30, status: "contacted", event_date: "2026-09-01", budget: "5000.00", assigned_to: 2, assigned_to_name: "Rep A" },
    { id: 11, contact_name: "Silent Lead", days_stale: 12, status: "qualified", event_date: null, budget: null, assigned_to: 3, assigned_to_name: "Rep B" },
  ],
};

const getFollowUpPreview = vi.fn().mockResolvedValue(PREVIEW);
const generateFollowUpDraft = vi.fn();

vi.mock("@/lib/api", () => ({
  api: {
    updateReminder: vi.fn().mockResolvedValue({}),
    getFollowUpPreview: () => getFollowUpPreview(),
    generateFollowUpDraft: (id: number) => generateFollowUpDraft(id),
  },
}));

import FollowUpsPage from "./page";

async function openDraftsPreview() {
  render(<FollowUpsPage />);
  fireEvent.click(screen.getByRole("button", { name: /AI Drafts/ }));
  fireEvent.click(screen.getByRole("button", { name: "Generate follow-ups" }));
  await screen.findByText("Quiet Lead"); // preview loaded
}

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
    // Team view shows the assignee on each card: initials avatar (titled with
    // the name) + name. getByTitle avoids matching the filter's <option>s.
    expect(screen.getByTitle("Rep A")).toBeTruthy();
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

describe("Generate follow-ups (preview → select → generate)", () => {
  beforeEach(() => {
    mockUser = { id: 1, role: "admin" };
    getFollowUpPreview.mockClear();
    generateFollowUpDraft.mockReset();
  });

  it("previews stale leads pre-ticked with their details", async () => {
    await openDraftsPreview();
    expect(getFollowUpPreview).toHaveBeenCalledTimes(1);
    expect(screen.getByText("30d stale")).toBeTruthy();
    expect(screen.getByText("Silent Lead")).toBeTruthy();
    const boxes = screen.getAllByRole("checkbox") as HTMLInputElement[];
    expect(boxes).toHaveLength(2);
    expect(boxes.every((b) => b.checked)).toBe(true);
    expect(screen.getByRole("button", { name: "Create 2 drafts" })).toBeTruthy();
  });

  it("only generates for still-selected leads, one call per lead", async () => {
    generateFollowUpDraft.mockResolvedValue({
      status: "created",
      draft: { id: 99, lead: 10, lead_name: "Quiet Lead", body: "Hi!", reasoning: "", status: "pending", model_used: "openai:gpt-test", channel: "whatsapp", whatsapp_message: null, reviewed_by: null, reviewed_by_name: null, reviewed_at: null, created_at: "2026-07-15" },
    });
    await openDraftsPreview();
    // Deselect "Silent Lead" — the human said no.
    fireEvent.click(screen.getByLabelText("Draft a follow-up for Silent Lead"));
    fireEvent.click(screen.getByRole("button", { name: "Create 1 draft" }));

    await screen.findByText(/1 draft created/);
    expect(generateFollowUpDraft).toHaveBeenCalledTimes(1);
    expect(generateFollowUpDraft).toHaveBeenCalledWith(10);
  });

  it("reports AI skips with their reasoning in the summary", async () => {
    generateFollowUpDraft
      .mockResolvedValueOnce({ status: "created", draft: { id: 99, lead: 10, lead_name: "Quiet Lead", body: "Hi!", reasoning: "", status: "pending", model_used: "openai:gpt-test", channel: "whatsapp", whatsapp_message: null, reviewed_by: null, reviewed_by_name: null, reviewed_at: null, created_at: "2026-07-15" } })
      .mockResolvedValueOnce({ status: "skipped", reasoning: "They asked for space." });
    await openDraftsPreview();
    fireEvent.click(screen.getByRole("button", { name: "Create 2 drafts" }));

    await screen.findByText(/1 draft created, 1 skipped by the AI/);
    expect(screen.getByText(/They asked for space\./)).toBeTruthy();
    expect(generateFollowUpDraft).toHaveBeenCalledTimes(2);
  });

  it("shows the empty state when nothing is stale", async () => {
    getFollowUpPreview.mockResolvedValueOnce({ configured: true, first_gap_days: 7, leads: [] });
    render(<FollowUpsPage />);
    fireEvent.click(screen.getByRole("button", { name: /AI Drafts/ }));
    fireEvent.click(screen.getByRole("button", { name: "Generate follow-ups" }));
    await screen.findByText(/No stale leads right now/);
    expect(screen.getByText(/7 days/)).toBeTruthy();
  });
});
