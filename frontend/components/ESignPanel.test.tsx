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
});
