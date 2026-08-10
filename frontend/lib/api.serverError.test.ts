import { describe, it, expect, vi, beforeEach } from "vitest";
import { api } from "./api";

/**
 * What a 5xx is allowed to tell the user (REL-481).
 *
 * Stripping 5xx bodies is right by default — they are stack traces, HTML error
 * pages, gateway noise. But the send endpoint answers 502 with JSON whose
 * `detail` is the only actionable thing there is, and discarding it turned a
 * revoked mailbox into "Server error (502)" while the real reason sat unread in
 * the response.
 */
const mockFetch = vi.fn();
vi.stubGlobal("fetch", mockFetch);

function respond(status: number, text: string) {
  mockFetch.mockResolvedValue({
    ok: false,
    status,
    text: () => Promise.resolve(text),
    json: () => Promise.resolve(JSON.parse(text)),
  });
}

beforeEach(() => mockFetch.mockReset());

describe("5xx error bodies", () => {
  it("shows a structured detail we authored", async () => {
    respond(502, JSON.stringify({ detail: "Access to owner@acme.com was revoked. Please reconnect." }));
    await expect(api.getLeads()).rejects.toThrow(/revoked.*reconnect/i);
  });

  it("still hides an HTML error page", async () => {
    respond(500, "<html><body>Traceback (most recent call last): …</body></html>");
    await expect(api.getLeads()).rejects.toThrow("Server error (500)");
  });

  it("still hides a plain-text server error", async () => {
    respond(500, "Internal Server Error");
    await expect(api.getLeads()).rejects.toThrow("Server error (500)");
  });

  it("falls back to the status when the JSON has no detail", async () => {
    respond(503, JSON.stringify({ error: "upstream", trace: "…" }));
    await expect(api.getLeads()).rejects.toThrow("Server error (503)");
  });

  it("falls back when the detail is empty rather than showing a blank message", async () => {
    respond(502, JSON.stringify({ detail: "   " }));
    await expect(api.getLeads()).rejects.toThrow("Server error (502)");
  });

  it("does not treat a non-string detail as a message", async () => {
    respond(500, JSON.stringify({ detail: { nested: "object" } }));
    await expect(api.getLeads()).rejects.toThrow("Server error (500)");
  });
});
