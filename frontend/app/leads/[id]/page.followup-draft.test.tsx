/** The lead page's "Suggested Follow-up" card (REL-501).
 *
 * The second surface an AI follow-up draft appears on. The channel is chosen in
 * the Follow-ups review queue, not here — this card only has to send the draft
 * on the channel it was written for, and give the rep the subject to edit when
 * that channel is email.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";

vi.mock("next/navigation", () => ({
  useParams: () => ({ id: "10" }),
  useRouter: () => ({ push: vi.fn(), back: vi.fn() }),
}));
vi.mock("@/lib/auth", () => ({ useAuth: () => ({ user: { id: 1, role: "owner" } }) }));
vi.mock("@/components/ActivityTimeline", () => ({ default: () => null }));

const LEAD = {
  id: 10,
  contact_title: "Ms",
  contact_first_name: "Batool",
  contact_last_name: "Rizvi",
  contact_name: "Batool Rizvi",
  contact_phone: "+923001269792",
  contact_email: "batool@example.com",
  status: "contacted",
  status_label: "Contacted",
  source: "",
  event_type: "",
  event_date: null,
  guest_estimate: null,
  budget: null,
  notes: "",
  assigned_to: null,
  assigned_to_name: null,
  account: null,
  account_name: null,
  created_by: 1,
  created_by_name: "Owner",
  created_at: "2026-07-01T00:00:00Z",
  updated_at: "2026-07-01T00:00:00Z",
};

const WA_DRAFT = {
  id: 7,
  lead: 10,
  lead_name: "Batool Rizvi",
  lead_phone: "+923001269792",
  lead_email: "batool@example.com",
  channel: "whatsapp",
  subject: "",
  body: "Hello Ms Rizvi, checking in.",
  reasoning: "Quiet for a month.",
  status: "pending",
  model_used: "openai:gpt-test",
  client_message: null,
  email_available: true,
  reviewed_by: null,
  reviewed_by_name: null,
  reviewed_at: null,
  created_at: "2026-08-01",
};
const EMAIL_DRAFT = {
  ...WA_DRAFT,
  id: 8,
  channel: "email",
  subject: "Your wedding catering",
};

let mockDrafts: Record<string, unknown>[] = [];
const empty = { data: [], mutate: vi.fn() };
vi.mock("@/lib/hooks", () => ({
  useLead: () => ({ data: LEAD, error: null, isLoading: false, mutate: vi.fn() }),
  useSiteSettings: () => ({ data: { twilio_configured: true, whatsapp_enabled: true } }),
  useDateFormat: () => "DD/MM/YYYY",
  useFormatDateTime: () => (v: string | null) => v ?? "-",
  useProductLines: () => empty,
  useUsers: () => empty,
  useSources: () => empty,
  useEventTypes: () => empty,
  useServiceStyles: () => empty,
  useMealTypes: () => empty,
  useLeadStatuses: () => empty,
  useLostReasons: () => empty,
  useLeadReminders: () => empty,
  useLeadWhatsAppMessages: () => ({ data: [], mutate: vi.fn() }),
  useLeadFollowUpDrafts: () => ({ data: mockDrafts, mutate: vi.fn() }),
  useAccounts: () => empty,
  revalidate: vi.fn(),
}));

const approveFollowUpDraft = vi.fn().mockResolvedValue({});
vi.mock("@/lib/api", () => ({
  api: {
    approveFollowUpDraft: (id: number, overrides?: unknown) =>
      approveFollowUpDraft(id, overrides),
    dismissFollowUpDraft: vi.fn().mockResolvedValue({}),
    logLeadReply: vi.fn().mockResolvedValue({}),
    getAccounts: vi.fn().mockResolvedValue([]),
    markWhatsAppRead: vi.fn().mockResolvedValue({}),
    sendWhatsApp: vi.fn().mockResolvedValue({}),
  },
}));

import LeadPage from "./page";

describe("Lead page — suggested follow-up", () => {
  beforeEach(() => {
    approveFollowUpDraft.mockReset();
    approveFollowUpDraft.mockResolvedValue({});
    mockDrafts = [];
  });

  it("an email draft shows its subject and a Send via Email button", () => {
    mockDrafts = [EMAIL_DRAFT];
    render(<LeadPage />);
    expect((screen.getByLabelText("Subject") as HTMLInputElement).value)
      .toBe("Your wedding catering");
    expect(screen.getByRole("button", { name: "Send via Email" })).toBeTruthy();
  });

  it("sends the edited subject and body for an email draft", async () => {
    mockDrafts = [EMAIL_DRAFT];
    render(<LeadPage />);
    fireEvent.change(screen.getByLabelText("Subject"), {
      target: { value: "Your March 14 wedding" },
    });
    fireEvent.change(screen.getByDisplayValue("Hello Ms Rizvi, checking in."), {
      target: { value: "Rewritten by the rep." },
    });
    fireEvent.click(screen.getByRole("button", { name: "Send via Email" }));

    await waitFor(() => expect(approveFollowUpDraft).toHaveBeenCalledWith(8, {
      body: "Rewritten by the rep.",
      subject: "Your March 14 wedding",
    }));
  });

  it("a WhatsApp draft is unchanged: no subject, Approve & Send", async () => {
    mockDrafts = [WA_DRAFT];
    render(<LeadPage />);
    expect(screen.queryByLabelText("Subject")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Approve & Send" }));
    await waitFor(() => expect(approveFollowUpDraft).toHaveBeenCalledWith(7, {
      body: "Hello Ms Rizvi, checking in.",
    }));
  });

  it("posts what is on screen after a failed send, not a diff", async () => {
    // The server keeps the rep's last edit when a send fails, so a client that
    // only posts changes would resend text the rep has since taken back.
    mockDrafts = [EMAIL_DRAFT];
    approveFollowUpDraft.mockRejectedValueOnce(new Error("Mailbox is down."));
    render(<LeadPage />);
    const bodyBox = screen.getByDisplayValue("Hello Ms Rizvi, checking in.");

    fireEvent.change(bodyBox, { target: { value: "Oops, wrong text" } });
    fireEvent.click(screen.getByRole("button", { name: "Send via Email" }));
    await screen.findByText(/Mailbox is down/);

    fireEvent.change(bodyBox, { target: { value: "Hello Ms Rizvi, checking in." } });
    fireEvent.click(screen.getByRole("button", { name: "Send via Email" }));

    await waitFor(() => expect(approveFollowUpDraft).toHaveBeenLastCalledWith(8, {
      body: "Hello Ms Rizvi, checking in.",
      subject: "Your wedding catering",
    }));
  });

  it("the WhatsApp template preview carries no wrong-region wording", () => {
    // REL-501 AC10. This preview is the rep's only sight of the message before
    // it goes; it has to match backend/bookings/services/whatsapp_templates.py
    // word for word, or they approve one text and the client receives another.
    render(<LeadPage />);
    fireEvent.click(screen.getByRole("button", { name: "Send Message" }));
    fireEvent.change(screen.getByLabelText(/Template/), {
      target: { value: "follow_up" },
    });

    const preview = screen.getByPlaceholderText("Type your message...") as HTMLTextAreaElement;
    expect(preview.value).toContain("We wanted to follow up about your");
    expect(preview.value.toLowerCase()).not.toContain("enquiry");
  });

  it("shows why a send failed instead of losing the draft", async () => {
    mockDrafts = [EMAIL_DRAFT];
    approveFollowUpDraft.mockRejectedValueOnce(
      new Error("Your email connection needs renewing in Settings."));
    render(<LeadPage />);
    fireEvent.click(screen.getByRole("button", { name: "Send via Email" }));
    expect(await screen.findByText(/connection needs renewing/)).toBeTruthy();
    expect(screen.getByRole("button", { name: "Send via Email" })).toBeTruthy();
  });
});
