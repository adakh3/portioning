import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";

const h = vi.hoisted(() => ({ sendQuoteForSignature: vi.fn() }));

vi.mock("@/lib/api", () => ({
  api: { sendQuoteForSignature: h.sendQuoteForSignature },
}));

import ESignPanel from "./ESignPanel";

describe("ESignPanel (staff-side)", () => {
  beforeEach(() => h.sendQuoteForSignature.mockReset());

  it("mints a sign link and shows the shareable URL", async () => {
    h.sendQuoteForSignature.mockResolvedValue({ public_token: "abc-token", status: "sent" });

    render(<ESignPanel kind="quote" id={42} publicToken={null} signature={null} />);

    fireEvent.click(screen.getByRole("button", { name: /send for signature/i }));

    await waitFor(() => expect(h.sendQuoteForSignature).toHaveBeenCalledWith(42));
    const link = (await screen.findByLabelText("Client sign link")) as HTMLInputElement;
    expect(link.value).toContain("/b/abc-token");
  });

  it("shows the shareable link immediately when a token already exists", () => {
    render(<ESignPanel kind="quote" id={7} publicToken="existing-tok" signature={null} />);
    const link = screen.getByLabelText("Client sign link") as HTMLInputElement;
    expect(link.value).toContain("/b/existing-tok");
    expect(screen.queryByRole("button", { name: /send for signature/i })).not.toBeInTheDocument();
  });

  it("shows signed status instead of the send control once signed", () => {
    render(
      <ESignPanel kind="quote" id={7} publicToken="t" signature={{ signer_name: "Aisha Khan", signed_at: "2026-07-06T10:00:00Z" }} />
    );
    expect(screen.getByText(/Signed by Aisha Khan/)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /send for signature/i })).not.toBeInTheDocument();
  });

  it("offers a WhatsApp send with the sign link when the contact is reachable", () => {
    const open = vi.spyOn(window, "open").mockImplementation(() => null);
    render(
      <ESignPanel kind="quote" id={7} publicToken="tok-9" signature={null} contactPhone="+447700900123" contactName="Aisha Khan" subject="baby_shower" />
    );
    fireEvent.click(screen.getByRole("button", { name: /send via whatsapp/i }));
    expect(open).toHaveBeenCalledTimes(1);
    const url = open.mock.calls[0][0] as string;
    const msg = decodeURIComponent(url);
    expect(url).toContain("wa.me/447700900123"); // E.164 stripped of '+'
    expect(msg).toContain("/b/tok-9"); // sign link is in the message
    expect(msg).toContain("baby shower"); // event type humanized…
    expect(msg).not.toContain("baby_shower"); // …not the raw slug
    open.mockRestore();
  });

  it("hides the WhatsApp send when the contact has no valid phone", () => {
    render(<ESignPanel kind="quote" id={7} publicToken="tok-9" signature={null} contactPhone={null} contactName="Aisha" />);
    expect(screen.queryByRole("button", { name: /send via whatsapp/i })).not.toBeInTheDocument();
  });
});
