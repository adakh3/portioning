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
  contact_email: "",
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

let mockSettings: Record<string, unknown> | undefined;
let mockMessages: Record<string, unknown>[] = [];
const empty = { data: [], mutate: vi.fn() };
vi.mock("@/lib/hooks", () => ({
  useLead: () => ({ data: LEAD, error: null, isLoading: false, mutate: vi.fn() }),
  useSiteSettings: () => ({ data: mockSettings }),
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
  useLeadWhatsAppMessages: () => ({ data: mockMessages, mutate: vi.fn() }),
  useLeadFollowUpDrafts: () => empty,
  useAccounts: () => empty,
  revalidate: vi.fn(),
}));

const logLeadReply = vi.fn().mockResolvedValue({});
vi.mock("@/lib/api", () => ({
  api: {
    logLeadReply: (id: number) => logLeadReply(id),
    getAccounts: vi.fn().mockResolvedValue([]),
    // Only the Twilio-mode thread calls these; it mounts in the handed-off test.
    markWhatsAppRead: vi.fn().mockResolvedValue({}),
    sendWhatsApp: vi.fn().mockResolvedValue({}),
  },
}));

import LeadPage from "./page";

describe("Lead page WhatsApp shortcuts section", () => {
  beforeEach(() => {
    logLeadReply.mockClear();
    mockMessages = [];
  });

  it("shows the wa.me chip and logs a reply when Twilio is not active", async () => {
    mockSettings = { twilio_configured: false, whatsapp_shortcuts_enabled: true };
    render(<LeadPage />);
    const chip = screen.getByRole("link", { name: "Open chat on WhatsApp" });
    expect(chip.getAttribute("href")).toBe("https://wa.me/923001269792");

    fireEvent.click(screen.getByRole("button", { name: "Customer replied" }));
    await waitFor(() => expect(logLeadReply).toHaveBeenCalledWith(10));
    expect(screen.getByRole("button", { name: "Reply logged" })).toBeTruthy();
  });

  it("shows a handed-off message as handed off, not as sent or as a raw value", () => {
    // A shortcut share is logged but never confirmed (REL-445). The thread must
    // neither claim delivery nor leak the stored machine name at the user.
    mockSettings = { twilio_configured: true, whatsapp_enabled: true };
    mockMessages = [{
      id: 1, body: "Here is your quote", status: "handed_off",
      direction: "outbound", created_at: "2026-08-01T10:00:00Z",
      sent_by_name: "Owner", to_phone: "whatsapp:+923001269792",
    }];
    render(<LeadPage />);

    expect(screen.getByText("handed off")).toBeTruthy();
    expect(screen.queryByText("handed_off")).toBeNull();
    expect(screen.queryByText("sent")).toBeNull();
    expect(screen.queryByText("delivered")).toBeNull();
  });

  it("hides the shortcuts section when the org disabled shortcuts", () => {
    mockSettings = { twilio_configured: false, whatsapp_shortcuts_enabled: false };
    render(<LeadPage />);
    expect(screen.queryByRole("link", { name: "Open chat on WhatsApp" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Customer replied" })).toBeNull();
  });
});
