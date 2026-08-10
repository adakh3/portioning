import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor, within } from "@testing-library/react";

/**
 * REL-445 — the quote page's single send surface, driven through the real page.
 *
 * What these pin is the wiring: which payload actually reaches the API when a
 * rep edits a draft and hits send, that a shortcut send opens wa.me *and* gets
 * recorded, and that the three rival WhatsApp buttons are really gone rather
 * than merely hidden behind a flag.
 */
const h = vi.hoisted(() => ({
  draftClientMessage: vi.fn(),
  sendClientMessage: vi.fn(),
  mutateMessages: vi.fn(),
}));

vi.mock("next/navigation", () => ({
  useParams: () => ({ id: "42" }),
  useRouter: () => ({ push: vi.fn() }),
}));
vi.mock("@/components/MenuBuilder", () => ({ default: () => null }));
vi.mock("@/lib/auth", () => ({
  useAuth: () => ({ user: { id: 4, first_name: "O", last_name: "Owner", role: "owner" } }),
}));

const QUOTE = {
  id: 42, version: 2, status: "draft", event_date: "2026-03-14",
  contact_name: "Nadia Okonjo", contact_phone: "+447700900123", contact_email: "nadia@example.com",
  primary_contact: 3, account: null, is_b2b: false, public_token: "tok-1", signature: null,
  guest_count: 100, gents: 0, ladies: 0, price_per_head: "50.00", subtotal: "5000.00",
  total: "6000.00", tax_amount: "1000.00", tax_rate: "0.2000", service_charge_pct: "0",
  service_charge: "0.00", service_charge_taxable: false, gratuity_pct: "0", gratuity: "0.00",
  line_items: [], dishes: [], additional_meals: [], timeline_entries: [], event_type: "wedding",
  notes: "", internal_notes: "", created_at: "2026-02-01T00:00:00Z",
};

const PLATFORM_EMAIL = {
  email: { available: true, reason: null, address: "nadia@example.com", mailbox: "owner@acme.com" },
  whatsapp: { available: true, reason: null, address: "+447700900123", mechanism: "platform", number: "+14155238886" },
  default_channel: "email",
};
const SHORTCUT_ONLY = {
  email: { available: false, reason: "no_mailbox", address: "nadia@example.com", mailbox: "" },
  whatsapp: { available: true, reason: null, address: "+447700900123", mechanism: "shortcut", number: "" },
  default_channel: "whatsapp",
};

let availability: unknown = PLATFORM_EMAIL;
let ledger: unknown[] = [];

vi.mock("@/lib/hooks", () => ({
  useClientMessages: () => ({ data: ledger, isLoading: false, mutate: h.mutateMessages }),
  useMessagingStatus: () => ({ data: availability }),
  useQuote: () => ({ data: QUOTE, error: null, isLoading: false, mutate: vi.fn() }),
  useAccounts: () => ({ data: [] }),
  useContacts: () => ({ data: [{ id: 3, name: "Nadia Okonjo", phone: "+447700900123", account: null }] }),
  useAddOnProducts: () => ({ data: [] }),
  useVenues: () => ({ data: [] }),
  useSiteSettings: () => ({ data: { currency_symbol: "$", currency_code: "USD", date_format: "DD/MM/YYYY", price_rounding_step: "1", default_tax_rate: "0.2000", service_charge_default_pct: "0", service_charge_taxable_default: false, gratuity_default_pct: "0" } }),
  useDateFormat: () => "DD/MM/YYYY",
  useFormatDateTime: () => (v: string | null) => v ?? "-",
  useEventTypes: () => ({ data: [{ id: 1, value: "wedding", label: "Wedding" }] }),
  useServiceStyles: () => ({ data: [] }),
  useDishes: () => ({ data: [] }),
  useMealTypes: () => ({ data: [] }),
  useTimelinePresets: () => ({ data: [] }),
  useAllLeads: () => ({ data: [] }),
  useProductLines: () => ({ data: [] }),
  useUsers: () => ({ data: [] }),
  revalidate: vi.fn(),
}));

vi.mock("@/lib/api", () => ({
  api: {
    draftClientMessage: (...a: unknown[]) => h.draftClientMessage(...a),
    sendClientMessage: (...a: unknown[]) => h.sendClientMessage(...a),
    getAccount: () => Promise.resolve({ contacts: [] }),
    downloadQuotePDF: vi.fn(),
  },
}));

import QuoteDetailPage from "./page";

const AI_DRAFT = {
  subject: "Your booking from Acme (Q-42)",
  body: "Hello Nadia,\n\nPlease review and sign: https://app.example.com/b/tok-1",
  used_fallback: false, model_used: "openai:test", kind: "sign_link", channel: "email",
  link: "https://app.example.com/b/tok-1", attachment_filename: "Quote-42.pdf",
  llm_available: true, availability: PLATFORM_EMAIL,
};

async function openSendModal() {
  render(<QuoteDetailPage />);
  fireEvent.click(screen.getByRole("button", { name: "Send to Client" }));
  return screen.findByRole("dialog");
}

describe("Quote page — Send to Client", () => {
  beforeEach(() => {
    h.draftClientMessage.mockReset().mockResolvedValue(AI_DRAFT);
    h.sendClientMessage.mockReset().mockResolvedValue({ id: 1, channel: "email", status: "sent" });
    h.mutateMessages.mockClear();
    availability = PLATFORM_EMAIL;
    ledger = [];
  });

  it("sends the rep's EDITED subject and body, not the drafted ones", async () => {
    const dialog = await openSendModal();
    await waitFor(() => expect(h.draftClientMessage).toHaveBeenCalled());

    // The draft is a starting point; what goes out is whatever the rep leaves.
    fireEvent.change(await within(dialog).findByLabelText("Subject"), {
      target: { value: "Your proposal, revised" },
    });
    fireEvent.change(within(dialog).getByLabelText("Message"), {
      target: { value: "Hello Nadia, here it is." },
    });
    fireEvent.click(within(dialog).getByRole("button", { name: "Send email" }));

    await waitFor(() => expect(h.sendClientMessage).toHaveBeenCalledTimes(1));
    expect(h.sendClientMessage).toHaveBeenCalledWith("quote", 42, {
      kind: "sign_link",
      channel: "email",
      subject: "Your proposal, revised",
      body: "Hello Nadia, here it is.",
      // sign_link always carries its PDF; the opt-in flag is for composed
      // messages only, so it is false here (REL-478).
      attach: false,
    });
  });

  it("asks the backend to draft for the channel actually selected", async () => {
    const dialog = await openSendModal();
    await waitFor(() => expect(h.draftClientMessage).toHaveBeenCalledWith("quote", 42, { kind: "sign_link", channel: "email", attach: false }));

    fireEvent.click(within(dialog).getByRole("button", { name: "WhatsApp" }));
    await waitFor(() => expect(h.draftClientMessage).toHaveBeenCalledWith("quote", 42, { kind: "sign_link", channel: "whatsapp", attach: false }));
  });

  it("opens wa.me AND records the send when WhatsApp is shortcut-mode", async () => {
    availability = SHORTCUT_ONLY;
    h.draftClientMessage.mockResolvedValue({
      ...AI_DRAFT, channel: "whatsapp", attachment_filename: "", body: "Hi Nadia, sign here: https://app.example.com/b/tok-1",
    });
    const open = vi.spyOn(window, "open").mockImplementation(() => null);

    const dialog = await openSendModal();
    // Shortcut mode is a different button, because it is a different promise.
    const send = await within(dialog).findByRole("button", { name: "Open in WhatsApp" });
    fireEvent.click(send);

    await waitFor(() => expect(h.sendClientMessage).toHaveBeenCalled());
    expect(open).toHaveBeenCalledTimes(1);
    expect(open.mock.calls[0][0]).toContain("wa.me/447700900123");
    // Recorded too — a shortcut send the ledger never hears about is the bug
    // this whole slice exists to remove.
    expect(h.sendClientMessage.mock.calls[0][2]).toMatchObject({ channel: "whatsapp" });
    open.mockRestore();
  });

  it("never sends a subject on WhatsApp", async () => {
    availability = SHORTCUT_ONLY;
    h.draftClientMessage.mockResolvedValue({ ...AI_DRAFT, channel: "whatsapp", attachment_filename: "" });
    vi.spyOn(window, "open").mockImplementation(() => null);

    const dialog = await openSendModal();
    await within(dialog).findByLabelText("Message");
    expect(within(dialog).queryByLabelText("Subject")).toBeNull();

    fireEvent.click(within(dialog).getByRole("button", { name: "Open in WhatsApp" }));
    await waitFor(() => expect(h.sendClientMessage).toHaveBeenCalled());
    expect(h.sendClientMessage.mock.calls[0][2].subject).toBeUndefined();
  });

  it("shows the attachment only for an emailed booking document", async () => {
    const dialog = await openSendModal();
    expect(await within(dialog).findByText("Quote-42.pdf")).toBeTruthy();

    h.draftClientMessage.mockResolvedValue({ ...AI_DRAFT, channel: "whatsapp", attachment_filename: "" });
    fireEvent.click(within(dialog).getByRole("button", { name: "WhatsApp" }));
    await waitFor(() => expect(within(dialog).queryByText("Quote-42.pdf")).toBeNull());
  });

  // AC2b — the point of the slice: one send surface, not three.
  it("has no rival WhatsApp buttons and no 'did you send it?' dance", async () => {
    render(<QuoteDetailPage />);
    expect(screen.queryByRole("button", { name: /share via whatsapp/i })).toBeNull();
    expect(screen.queryByRole("button", { name: /send via whatsapp/i })).toBeNull();
    expect(screen.queryByRole("button", { name: /mark shared/i })).toBeNull();
    expect(screen.queryByRole("button", { name: /^not sent$/i })).toBeNull();
    expect(screen.queryByText(/did you send it/i)).toBeNull();
    expect(screen.getByRole("button", { name: "Send to Client" })).toBeTruthy();
  });
});

describe("Quote page — the message ledger", () => {
  beforeEach(() => {
    h.draftClientMessage.mockReset().mockResolvedValue(AI_DRAFT);
    h.sendClientMessage.mockReset().mockResolvedValue({ id: 9 });
    availability = PLATFORM_EMAIL;
  });

  const row = (over: Record<string, unknown>) => ({
    id: 1, lead: null, quote: 42, event: null, reminder: null, channel: "whatsapp",
    to_phone: "+447700900123", from_phone: "", to_email: "", recipient: "+447700900123",
    subject: "", body: "Here is your quote", attachment_filename: "", direction: "outbound",
    status: "sent", twilio_sid: "", provider_message_id: "", error_code: "", error_message: "",
    sent_by: 4, sent_by_name: "Owner", is_automatic: false,
    created_at: "2026-08-01T10:00:00Z", updated_at: "2026-08-01T10:00:00Z", ...over,
  });

  it("never renders a shortcut send as sent, and offers it no Retry", () => {
    ledger = [row({ status: "handed_off" })];
    render(<QuoteDetailPage />);

    expect(screen.getByText("handed off")).toBeTruthy();
    expect(screen.queryByText("handed_off")).toBeNull();      // not the raw value
    expect(screen.getByText(/logged here, delivery not confirmed/i)).toBeTruthy();
    // Retry would imply the platform had tried. It never did.
    expect(screen.queryByRole("button", { name: "Retry" })).toBeNull();
  });

  it("shows a to_send row as a task for a human, never as a send", () => {
    ledger = [row({ status: "to_send", is_automatic: true })];
    render(<QuoteDetailPage />);

    expect(screen.getByText("to send")).toBeTruthy();
    expect(screen.getByText("Automatic")).toBeTruthy();
    expect(screen.getByText(/send this one yourself/i)).toBeTruthy();
    expect(screen.getByRole("button", { name: "Open in WhatsApp" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Retry" })).toBeNull();
  });

  it("offers Retry with the failure reason on a platform failure", () => {
    ledger = [row({ channel: "email", status: "failed", to_email: "nadia@example.com",
                    recipient: "nadia@example.com", subject: "Your booking",
                    error_message: "No connected mailbox" })];
    render(<QuoteDetailPage />);

    expect(screen.getByText("failed")).toBeTruthy();
    expect(screen.getByText("No connected mailbox")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Retry" })).toBeTruthy();
  });

  it("reopens a failed message with its own wording rather than redrafting", async () => {
    ledger = [row({ channel: "email", status: "failed", subject: "Original subject",
                    body: "Original body", recipient: "nadia@example.com" })];
    render(<QuoteDetailPage />);
    fireEvent.click(screen.getByRole("button", { name: "Retry" }));

    const dialog = await screen.findByRole("dialog");
    expect((await within(dialog).findByLabelText("Subject") as HTMLInputElement).value)
      .toBe("Original subject");
    expect((within(dialog).getByLabelText("Message") as HTMLTextAreaElement).value)
      .toBe("Original body");
    // A human already approved this text; asking a model to rewrite it would
    // quietly change what gets sent on a retry.
    expect(h.draftClientMessage).not.toHaveBeenCalled();
    expect(within(dialog).getByText("Previous wording")).toBeTruthy();
  });
});
