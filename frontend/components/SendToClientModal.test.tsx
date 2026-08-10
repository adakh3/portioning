import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";

/**
 * The two rules the design handoff calls out as easy to get wrong:
 *
 *  1. The email option can be off for three different reasons with three
 *     different fixes. Collapsing them sends the caterer to the wrong screen.
 *  2. The ✦ marker must vanish entirely when no model is available — on BOTH
 *     channels. The named bug is the WhatsApp branch forgetting to check.
 */
const h = vi.hoisted(() => ({ draft: vi.fn(), send: vi.fn() }));

vi.mock("@/lib/api", () => ({
  api: {
    draftClientMessage: (...a: unknown[]) => h.draft(...a),
    sendClientMessage: (...a: unknown[]) => h.send(...a),
  },
}));

import SendToClientModal from "./SendToClientModal";

const DRAFT = {
  subject: "S", body: "B", used_fallback: false, model_used: "openai:test",
  kind: "compose", channel: "email", link: "", attachment_filename: "",
  attachment_available: true,
  llm_available: true, availability: null,
};

function availability(over: Record<string, unknown> = {}) {
  return {
    email: { available: true, reason: null, address: "n@example.com", mailbox: "owner@acme.com" },
    whatsapp: { available: true, reason: null, address: "+447700900123", mechanism: "platform", number: "+1415" },
    default_channel: "email",
    ...over,
  } as never;
}

function show(props: Record<string, unknown> = {}) {
  return render(
    <SendToClientModal
      open
      onClose={vi.fn()}
      parent="quote"
      parentId={42}
      kind="compose"
      availability={availability()}
      {...props}
    />
  );
}

describe("Send modal — why email is unavailable", () => {
  beforeEach(() => { h.draft.mockReset().mockResolvedValue(DRAFT); h.send.mockReset(); });

  it("offers a Settings link when no mailbox is connected", async () => {
    show({ availability: availability({
      email: { available: false, reason: "no_mailbox", address: "n@example.com", mailbox: "" },
      default_channel: "whatsapp",
    }) });
    const link = await screen.findByRole("link", { name: /connect your email in settings/i });
    expect(link.getAttribute("href")).toBe("/settings?tab=integrations");
  });

  it("asks for a reconnect — not a connect — when the grant died", async () => {
    show({ availability: availability({
      email: { available: false, reason: "mailbox_needs_reconnect", address: "n@example.com", mailbox: "owner@acme.com" },
      default_channel: "whatsapp",
    }) });
    // Telling someone to "connect" an account they already connected reads as
    // the platform having lost their setup.
    expect(await screen.findByRole("link", { name: /needs renewing in settings/i })).toBeTruthy();
    expect(screen.queryByText(/connect your email in settings/i)).toBeNull();
  });

  it("points at the customer record — with NO Settings link — when the contact has no address", async () => {
    show({ availability: availability({
      email: { available: false, reason: "no_email_address", address: "", mailbox: "owner@acme.com" },
      default_channel: "whatsapp",
    }) });
    expect(await screen.findByText(/no email address on file/i)).toBeTruthy();
    // This is a record problem; a Settings link would be the wrong screen.
    expect(screen.queryByRole("link")).toBeNull();
  });

  it("disables the email segment rather than hiding it", async () => {
    show({ availability: availability({
      email: { available: false, reason: "no_mailbox", address: "", mailbox: "" },
      default_channel: "whatsapp",
    }) });
    expect((await screen.findByRole("button", { name: "Email" })).hasAttribute("disabled")).toBe(true);
  });
});

describe("Send modal — the AI marker", () => {
  beforeEach(() => { h.draft.mockReset(); h.send.mockReset(); });

  it("marks the draft when a model actually wrote it", async () => {
    h.draft.mockResolvedValue({ ...DRAFT, llm_available: true, used_fallback: false });
    show();
    expect(await screen.findByText("AI draft")).toBeTruthy();
    expect(screen.queryByText("Standard template")).toBeNull();
  });

  it("disappears entirely when no model is available — on email", async () => {
    h.draft.mockResolvedValue({ ...DRAFT, llm_available: false, used_fallback: true });
    const { container } = show();
    await screen.findByText("Standard template");
    expect(screen.getByText(/AI drafting is unavailable/i)).toBeTruthy();
    expect(container.textContent).not.toContain("✦");
  });

  it("disappears on WhatsApp too — the branch that forgets is the known bug", async () => {
    h.draft.mockResolvedValue({ ...DRAFT, channel: "whatsapp", llm_available: false, used_fallback: true });
    const { container } = show({ availability: availability({ default_channel: "whatsapp" }) });
    await screen.findByText("Standard template");
    expect(container.textContent).not.toContain("✦");
  });
});

describe("Send modal — drafting never blocks sending", () => {
  beforeEach(() => { h.draft.mockReset(); h.send.mockReset().mockResolvedValue({ id: 1 }); });

  it("leaves an editable box when the draft request fails", async () => {
    h.draft.mockRejectedValue(new Error("drafter exploded"));
    show();

    const body = await screen.findByLabelText("Message");
    expect(screen.getByText("drafter exploded")).toBeTruthy();
    // The rep can still type and send — a model outage is not a send outage.
    fireEvent.change(body, { target: { value: "Typed by hand" } });
    fireEvent.click(screen.getByRole("button", { name: "Send email" }));
    await waitFor(() => expect(h.send).toHaveBeenCalled());
    expect(h.send.mock.calls[0][2].body).toBe("Typed by hand");
  });

  it("will not send an empty message", async () => {
    h.draft.mockResolvedValue({ ...DRAFT, body: "" });
    show();
    await screen.findByLabelText("Message");
    expect((screen.getByRole("button", { name: "Send email" }) as HTMLButtonElement).disabled).toBe(true);
  });
});

/**
 * Attaching the booking PDF to an ordinary composed message (REL-478).
 *
 * The rule that matters: what the draft SAYS and what actually goes must agree.
 * A message reading "please find attached" with nothing attached is worse than
 * one that never mentions a document.
 */
describe("Send modal — attaching the PDF to a composed message", () => {
  beforeEach(() => { h.draft.mockReset().mockResolvedValue(DRAFT); h.send.mockReset(); });

  const attachBox = () => screen.getByRole("checkbox", { name: /attach the pdf/i });

  it("offers the option on email, switched off", async () => {
    show();
    await waitFor(() => expect(attachBox()).toBeTruthy());
    expect((attachBox() as HTMLInputElement).checked).toBe(false);
  });

  it("redrafts when switched on, so the wording can mention the attachment", async () => {
    show();
    await waitFor(() => expect(attachBox()).toBeTruthy());
    h.draft.mockClear();
    fireEvent.click(attachBox());
    await waitFor(() => expect(h.draft).toHaveBeenCalled());
    expect(h.draft.mock.calls[0][2]).toMatchObject({ attach: true });
  });

  it("sends the flag the rep actually chose", async () => {
    h.send.mockResolvedValue({ id: 1 });
    show();
    await waitFor(() => expect(attachBox()).toBeTruthy());
    fireEvent.click(attachBox());
    await waitFor(() => expect((attachBox() as HTMLInputElement).checked).toBe(true));
    fireEvent.click(screen.getByRole("button", { name: /send email/i }));
    await waitFor(() => expect(h.send).toHaveBeenCalled());
    expect(h.send.mock.calls[0][2]).toMatchObject({ attach: true });
  });

  it("sends nothing attached when left alone", async () => {
    h.send.mockResolvedValue({ id: 1 });
    show();
    await waitFor(() => expect(attachBox()).toBeTruthy());
    fireEvent.click(screen.getByRole("button", { name: /send email/i }));
    await waitFor(() => expect(h.send).toHaveBeenCalled());
    expect(h.send.mock.calls[0][2]).toMatchObject({ attach: false });
  });

  it("never discards wording the rep typed", async () => {
    // Redrafting to mention an attachment is not worth losing a sentence
    // someone wrote themselves.
    show();
    await waitFor(() => expect(attachBox()).toBeTruthy());
    fireEvent.change(screen.getByLabelText("Message"), {
      target: { value: "My own carefully written note" },
    });
    h.draft.mockClear();
    fireEvent.click(attachBox());
    await waitFor(() => expect((attachBox() as HTMLInputElement).checked).toBe(true));
    expect(h.draft).not.toHaveBeenCalled();
    expect((screen.getByLabelText("Message") as HTMLTextAreaElement).value)
      .toBe("My own carefully written note");
  });

  it("is not offered on WhatsApp, which carries a link", async () => {
    h.draft.mockResolvedValue({ ...DRAFT, channel: "whatsapp", attachment_available: false });
    show({ availability: availability({ default_channel: "whatsapp" }) });
    await waitFor(() => expect(h.draft).toHaveBeenCalled());
    expect(screen.queryByRole("checkbox", { name: /attach the pdf/i })).toBeNull();
  });

  it("is not offered where there is no document — a lead", async () => {
    h.draft.mockResolvedValue({ ...DRAFT, attachment_available: false });
    show({ parent: "lead" });
    await waitFor(() => expect(h.draft).toHaveBeenCalled());
    expect(screen.queryByRole("checkbox", { name: /attach the pdf/i })).toBeNull();
  });

  it("names the file once one is actually going", async () => {
    h.draft.mockResolvedValue({ ...DRAFT, attachment_filename: "Quote-92.pdf" });
    show();
    expect(await screen.findByText("Quote-92.pdf")).toBeTruthy();
  });
});

/**
 * Every combination of the two channels being configured or not. Each renders
 * something different, so each is asserted rather than assumed.
 */
describe("Send modal — the channel matrix", () => {
  beforeEach(() => { h.draft.mockReset().mockResolvedValue(DRAFT); h.send.mockReset(); });

  const btn = (name: RegExp) => screen.getByRole("button", { name });

  it("both configured: either channel can be picked", async () => {
    show();
    await waitFor(() => expect(h.draft).toHaveBeenCalled());
    expect((btn(/^email$/i) as HTMLButtonElement).disabled).toBe(false);
    expect((btn(/^whatsapp$/i) as HTMLButtonElement).disabled).toBe(false);
  });

  it("email only: WhatsApp is disabled, not hidden", async () => {
    show({ availability: availability({
      whatsapp: { available: false, reason: "no_phone", address: "", mechanism: "shortcut", number: "" },
    }) });
    await waitFor(() => expect(h.draft).toHaveBeenCalled());
    expect((btn(/^whatsapp$/i) as HTMLButtonElement).disabled).toBe(true);
    expect((btn(/^email$/i) as HTMLButtonElement).disabled).toBe(false);
  });

  it("WhatsApp only: email is disabled and the reason is shown", async () => {
    show({ availability: availability({
      email: { available: false, reason: "no_mailbox", address: "", mailbox: "" },
      default_channel: "whatsapp",
    }) });
    await waitFor(() => expect(h.draft).toHaveBeenCalled());
    expect((btn(/^email$/i) as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByRole("link", { name: /connect your email/i })).toBeTruthy();
  });

  it("neither: says so plainly and refuses to send", async () => {
    show({ availability: availability({
      email: { available: false, reason: "no_email_address", address: "", mailbox: "owner@acme.com" },
      whatsapp: { available: false, reason: "no_phone", address: "", mechanism: "shortcut", number: "" },
    }) });
    expect(await screen.findByText(/no email address and no whatsapp number/i)).toBeTruthy();
    await waitFor(() => {
      const send = screen.getByRole("button", { name: /send|open in whatsapp/i }) as HTMLButtonElement;
      expect(send.disabled).toBe(true);
    });
  });
});
