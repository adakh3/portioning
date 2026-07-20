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
const empty = { data: [], mutate: vi.fn() };
vi.mock("@/lib/hooks", () => ({
  useLead: () => ({ data: LEAD, error: null, isLoading: false, mutate: vi.fn() }),
  useSiteSettings: () => ({ data: mockSettings }),
  useDateFormat: () => "DD/MM/YYYY",
  useProductLines: () => empty,
  useUsers: () => empty,
  useSources: () => empty,
  useEventTypes: () => empty,
  useServiceStyles: () => empty,
  useMealTypes: () => empty,
  useLeadStatuses: () => empty,
  useLostReasons: () => empty,
  useLeadReminders: () => empty,
  useLeadWhatsAppMessages: () => empty,
  useLeadFollowUpDrafts: () => empty,
  useAccounts: () => empty,
  revalidate: vi.fn(),
}));

const logLeadReply = vi.fn().mockResolvedValue({});
vi.mock("@/lib/api", () => ({
  api: {
    logLeadReply: (id: number) => logLeadReply(id),
    getAccounts: vi.fn().mockResolvedValue([]),
  },
}));

import LeadPage from "./page";

describe("Lead page WhatsApp shortcuts section", () => {
  beforeEach(() => logLeadReply.mockClear());

  it("shows the wa.me chip and logs a reply when Twilio is not active", async () => {
    mockSettings = { twilio_configured: false, whatsapp_shortcuts_enabled: true };
    render(<LeadPage />);
    const chip = screen.getByRole("link", { name: "Open chat on WhatsApp" });
    expect(chip.getAttribute("href")).toBe("https://wa.me/923001269792");

    fireEvent.click(screen.getByRole("button", { name: "Customer replied" }));
    await waitFor(() => expect(logLeadReply).toHaveBeenCalledWith(10));
    expect(screen.getByRole("button", { name: "Reply logged" })).toBeTruthy();
  });

  it("hides the shortcuts section when the org disabled shortcuts", () => {
    mockSettings = { twilio_configured: false, whatsapp_shortcuts_enabled: false };
    render(<LeadPage />);
    expect(screen.queryByRole("link", { name: "Open chat on WhatsApp" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Customer replied" })).toBeNull();
  });
});
