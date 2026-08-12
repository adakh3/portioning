import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";

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
let mockSettings: Record<string, unknown> | undefined;
let mockDrafts: unknown[] = [];
vi.mock("@/lib/hooks", () => ({
  useReminders: (p: unknown) => useReminders(p),
  useUsers: () => ({ data: USERS }),
  useFollowUpDrafts: () => ({ data: mockDrafts, mutate: vi.fn() }),
  useSiteSettings: () => ({ data: mockSettings }),
  useDateFormat: () => "DD/MM/YYYY",
  useFormatDateTime: () => (v: string | null) => v ?? "-",
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

const markFollowUpSent = vi.fn().mockResolvedValue({});
const approveFollowUpDraft = vi.fn().mockResolvedValue({});
const bulkApproveFollowUpDrafts = vi.fn().mockResolvedValue({ sent: [], failed: [] });
vi.mock("@/lib/api", () => ({
  api: {
    updateReminder: vi.fn().mockResolvedValue({}),
    getFollowUpPreview: () => getFollowUpPreview(),
    generateFollowUpDraft: (id: number) => generateFollowUpDraft(id),
    markFollowUpSent: (id: number, body?: string) => markFollowUpSent(id, body),
    approveFollowUpDraft: (id: number, overrides?: unknown) => approveFollowUpDraft(id, overrides),
    bulkApproveFollowUpDrafts: (ids?: number[]) => bulkApproveFollowUpDrafts(ids),
  },
}));

const DRAFT = {
  id: 7, lead: 10, lead_name: "Quiet Lead", lead_phone: "+923001269792",
  lead_email: "rizvi@example.com",
  body: "Hello Ms Rizvi,", subject: "", reasoning: "", status: "pending",
  model_used: "openai:gpt-test", channel: "whatsapp", client_message: null,
  email_available: false,
  reviewed_by: null, reviewed_by_name: null, reviewed_at: null, created_at: "2026-07-18",
};

import FollowUpsPage from "./page";

async function openDraftsPreview() {
  render(<FollowUpsPage />);
  fireEvent.click(screen.getByRole("button", { name: /AI Follow-ups/ }));
  fireEvent.click(screen.getByRole("button", { name: "Generate follow-ups" }));
  await screen.findByText("Quiet Lead"); // preview loaded
}

describe("FollowUpsPage", () => {
  beforeEach(() => {
    useReminders.mockClear();
    mockSettings = undefined;
    mockDrafts = [];
  });

  it("hides the person filter for a salesperson and requests their own scope", () => {
    mockUser = { id: 2, role: "salesperson" };
    render(<FollowUpsPage />);
    fireEvent.click(screen.getByRole("button", { name: "Reminders" }));
    expect(screen.queryByLabelText("Filter follow-ups by person")).toBeNull();
    // Salespeople never pass a user filter — the backend forces their own.
    expect(useReminders).toHaveBeenLastCalledWith({ status: "pending", user: undefined });
  });

  it("shows a team view + person filter for an admin", () => {
    mockUser = { id: 1, role: "admin" };
    render(<FollowUpsPage />);
    fireEvent.click(screen.getByRole("button", { name: "Reminders" }));
    // Team view shows the assignee on each card: initials avatar (titled with
    // the name) + name. getByTitle avoids matching the filter's <option>s.
    expect(screen.getByTitle("Rep A")).toBeTruthy();
    const select = screen.getByLabelText("Filter follow-ups by person") as HTMLSelectElement;
    expect(select).toBeTruthy();
  });

  it("passes the selected person as the user filter", () => {
    mockUser = { id: 1, role: "admin" };
    render(<FollowUpsPage />);
    fireEvent.click(screen.getByRole("button", { name: "Reminders" }));
    const select = screen.getByLabelText("Filter follow-ups by person") as HTMLSelectElement;
    fireEvent.change(select, { target: { value: "3" } });
    expect(useReminders).toHaveBeenLastCalledWith({ status: "pending", user: "3" });
  });
});

describe("Generate follow-ups (preview → select → generate)", () => {
  beforeEach(() => {
    mockUser = { id: 1, role: "admin" };
    mockSettings = undefined;
    mockDrafts = [];
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
      draft: { id: 99, lead: 10, lead_name: "Quiet Lead", body: "Hi!", reasoning: "", status: "pending", model_used: "openai:gpt-test", channel: "whatsapp", subject: "", client_message: null, reviewed_by: null, reviewed_by_name: null, reviewed_at: null, created_at: "2026-07-15" },
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
      .mockResolvedValueOnce({ status: "created", draft: { id: 99, lead: 10, lead_name: "Quiet Lead", body: "Hi!", reasoning: "", status: "pending", model_used: "openai:gpt-test", channel: "whatsapp", subject: "", client_message: null, reviewed_by: null, reviewed_by_name: null, reviewed_at: null, created_at: "2026-07-15" } })
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
    fireEvent.click(screen.getByRole("button", { name: /AI Follow-ups/ }));
    fireEvent.click(screen.getByRole("button", { name: "Generate follow-ups" }));
    await screen.findByText(/No stale leads right now/);
    expect(screen.getByText(/7 days/)).toBeTruthy();
  });
});

describe("WhatsApp shortcuts mode (no Twilio)", () => {
  beforeEach(() => {
    mockUser = { id: 1, role: "admin" };
    mockDrafts = [DRAFT];
    markFollowUpSent.mockClear();
    vi.spyOn(window, "open").mockImplementation(() => null);
  });

  it("swaps Approve & Send for the WhatsApp button and hides bulk", () => {
    mockSettings = { twilio_configured: false, whatsapp_shortcuts_enabled: true };
    render(<FollowUpsPage />);
    expect(screen.getByRole("button", { name: /Send via WhatsApp/ })).toBeTruthy();
    expect(screen.queryByRole("button", { name: /Approve & Send/ })).toBeNull();
    expect(screen.queryByRole("button", { name: /Approve & send all/ })).toBeNull();
  });

  it("keeps the Twilio buttons when Twilio is active", () => {
    mockSettings = { twilio_configured: true, whatsapp_enabled: true, whatsapp_shortcuts_enabled: true };
    render(<FollowUpsPage />);
    expect(screen.getByRole("button", { name: "Approve & Send" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: /Send via WhatsApp/ })).toBeNull();
  });

  it("hides shortcuts when the org disabled them", () => {
    mockSettings = { twilio_configured: false, whatsapp_shortcuts_enabled: false };
    render(<FollowUpsPage />);
    expect(screen.queryByRole("button", { name: /Send via WhatsApp/ })).toBeNull();
  });

  it("opens wa.me with the edited body, then marks sent on confirm", async () => {
    mockSettings = { twilio_configured: false, whatsapp_shortcuts_enabled: true };
    render(<FollowUpsPage />);
    fireEvent.click(screen.getByRole("button", { name: /Send via WhatsApp/ }));
    expect(window.open).toHaveBeenCalledWith(
      "https://wa.me/923001269792?text=Hello%20Ms%20Rizvi%2C", "_blank");
    fireEvent.click(screen.getByRole("button", { name: "Mark sent" }));
    // The channel rides along now (REL-501) so the backend records the handoff
    // even when the draft it started from was written for email.
    await waitFor(() => expect(markFollowUpSent).toHaveBeenCalledWith(7, {
      body: "Hello Ms Rizvi,", channel: "whatsapp",
    }));
  });

  it("Not sent returns the card to pending state", () => {
    mockSettings = { twilio_configured: false, whatsapp_shortcuts_enabled: true };
    render(<FollowUpsPage />);
    fireEvent.click(screen.getByRole("button", { name: /Send via WhatsApp/ }));
    fireEvent.click(screen.getByRole("button", { name: "Not sent" }));
    expect(screen.getByRole("button", { name: /Send via WhatsApp/ })).toBeTruthy();
    expect(markFollowUpSent).not.toHaveBeenCalled();
  });
});

// REL-501: email as a follow-up channel. The card mirrors SendToClientModal —
// same segmented control, same subject field — so a rep meets one way of
// choosing a channel across the app.
describe("Email follow-up drafts", () => {
  const EMAIL_DRAFT = {
    ...DRAFT,
    id: 8,
    channel: "email",
    subject: "Your wedding catering",
    email_available: true,
  };

  beforeEach(() => {
    mockUser = { id: 1, role: "admin" };
    // Shortcuts mode on purpose: an email draft must be sendable from the app
    // even where WhatsApp can only be handed to the rep's own phone.
    mockSettings = { twilio_configured: false, whatsapp_shortcuts_enabled: true };
    mockDrafts = [EMAIL_DRAFT];
    approveFollowUpDraft.mockReset();
    approveFollowUpDraft.mockResolvedValue({});
    bulkApproveFollowUpDrafts.mockClear();
    vi.spyOn(window, "open").mockImplementation(() => null);
  });

  it("offers Send via Email, not the WhatsApp handoff", () => {
    render(<FollowUpsPage />);
    expect(screen.getByRole("button", { name: /Send via Email/ })).toBeTruthy();
    expect(screen.queryByRole("button", { name: /Send via WhatsApp/ })).toBeNull();
  });

  it("shows the drafted subject, editable, and sends the edit", async () => {
    render(<FollowUpsPage />);
    const subject = screen.getByLabelText("Subject") as HTMLInputElement;
    expect(subject.value).toBe("Your wedding catering");

    fireEvent.change(subject, { target: { value: "Your March 14 wedding" } });
    fireEvent.click(screen.getByRole("button", { name: /Send via Email/ }));

    await waitFor(() => expect(approveFollowUpDraft).toHaveBeenCalledWith(8, {
      body: "Hello Ms Rizvi,",
      channel: "email",
      subject: "Your March 14 wedding",
    }));
  });

  it("posts what is on screen even when nothing was edited", async () => {
    // NOT a diff against the cached draft: the server persists overrides before
    // it tries to send and keeps them on failure, so "unchanged" is not a safe
    // thing for the client to assume.
    render(<FollowUpsPage />);
    fireEvent.click(screen.getByRole("button", { name: /Send via Email/ }));
    await waitFor(() => expect(approveFollowUpDraft).toHaveBeenCalledWith(8, {
      body: "Hello Ms Rizvi,",
      channel: "email",
      subject: "Your wedding catering",
    }));
  });

  it("a reverted edit after a failed send goes out reverted", async () => {
    approveFollowUpDraft.mockRejectedValueOnce(new Error("Mailbox is down."));
    render(<FollowUpsPage />);
    const bodyBox = screen.getByDisplayValue("Hello Ms Rizvi,");

    fireEvent.change(bodyBox, { target: { value: "Oops, wrong text" } });
    fireEvent.click(screen.getByRole("button", { name: /Send via Email/ }));
    await screen.findByText(/Mailbox is down/);

    fireEvent.change(bodyBox, { target: { value: "Hello Ms Rizvi," } });
    fireEvent.click(screen.getByRole("button", { name: /Send via Email/ }));

    await waitFor(() => expect(approveFollowUpDraft).toHaveBeenLastCalledWith(8, {
      body: "Hello Ms Rizvi,",
      channel: "email",
      subject: "Your wedding catering",
    }));
  });

  it("lets the rep switch to WhatsApp, hand it off, and mark it sent", async () => {
    render(<FollowUpsPage />);
    fireEvent.click(screen.getByRole("button", { name: "WhatsApp" }));

    // The subject line belongs to email only.
    expect(screen.queryByLabelText("Subject")).toBeNull();
    // …and the shortcut path takes over, exactly as for a WhatsApp draft.
    fireEvent.click(screen.getByRole("button", { name: /Send via WhatsApp/ }));
    expect(window.open).toHaveBeenCalledWith(
      "https://wa.me/923001269792?text=Hello%20Ms%20Rizvi%2C", "_blank");

    // The confirmation must carry the switch, or the backend still sees an
    // email draft and refuses to record a message the client already has.
    fireEvent.click(screen.getByRole("button", { name: "Mark sent" }));
    await waitFor(() => expect(markFollowUpSent).toHaveBeenCalledWith(8, {
      body: "Hello Ms Rizvi,",
      channel: "whatsapp",
    }));
  });

  it("switching a WhatsApp draft to email posts the channel and a visible subject", async () => {
    mockDrafts = [{ ...DRAFT, email_available: true, lead_event_type: "wedding" }];
    render(<FollowUpsPage />);
    fireEvent.click(screen.getByRole("button", { name: "Email" }));

    // A WhatsApp draft has no subject; the rep must see the one that will go
    // out rather than the backend quietly substituting it.
    expect((screen.getByLabelText("Subject") as HTMLInputElement).value)
      .toBe("Your wedding catering");

    fireEvent.click(screen.getByRole("button", { name: /Send via Email/ }));
    await waitFor(() => expect(approveFollowUpDraft).toHaveBeenCalledWith(7, {
      body: "Hello Ms Rizvi,",
      channel: "email",
      subject: "Your wedding catering",
    }));
  });

  it("disables the email option when the org cannot send email", () => {
    mockDrafts = [{ ...DRAFT, email_available: false }];
    render(<FollowUpsPage />);
    const emailOption = screen.getByRole("button", { name: "Email" }) as HTMLButtonElement;
    expect(emailOption.disabled).toBe(true);
  });

  it("tells a caterer with a dead mailbox to renew it, not to connect one", () => {
    mockDrafts = [{ ...EMAIL_DRAFT, email_available: false, email_reason: "mailbox_needs_reconnect" }];
    render(<FollowUpsPage />);
    expect(screen.getByText(/needs renewing/)).toBeTruthy();
    expect(screen.queryByText(/Connect your email/)).toBeNull();
  });

  it("blames the lead's record when that is what's missing", () => {
    mockDrafts = [{ ...EMAIL_DRAFT, email_available: false, email_reason: "no_email_address" }];
    render(<FollowUpsPage />);
    expect(screen.getByText(/no valid email address/)).toBeTruthy();
  });

  it("disables WhatsApp when the lead has no valid number", () => {
    mockDrafts = [{ ...EMAIL_DRAFT, lead_phone: "07700 900000" }];
    render(<FollowUpsPage />);
    const waOption = screen.getByRole("button", { name: "WhatsApp" }) as HTMLButtonElement;
    expect(waOption.disabled).toBe(true);
  });

  it("offers a bulk send for the email drafts even in shortcuts mode", async () => {
    mockDrafts = [EMAIL_DRAFT, DRAFT];   // one email, one WhatsApp
    render(<FollowUpsPage />);
    fireEvent.click(screen.getByRole("button", { name: /Send all emails \(1\)/ }));
    // Only the email draft — a WhatsApp draft here can only leave from a phone.
    await waitFor(() => expect(bulkApproveFollowUpDrafts).toHaveBeenCalledWith([8]));
  });

  it("surfaces the reason a send failed and keeps the card", async () => {
    approveFollowUpDraft.mockRejectedValueOnce(
      new Error("Your email connection needs renewing in Settings."));
    render(<FollowUpsPage />);
    fireEvent.click(screen.getByRole("button", { name: /Send via Email/ }));
    expect(await screen.findByText(/connection needs renewing/)).toBeTruthy();
    expect(screen.getByRole("button", { name: /Send via Email/ })).toBeTruthy();
  });
});
