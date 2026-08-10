import { describe, it, expect } from "vitest";
import { safeReturnTo } from "./auth";

// `returnTo` is read off the query string and handed to router.replace/push,
// so it is attacker-controllable input on a page where the user is about to
// type a password (REL-477).

describe("safeReturnTo", () => {
  it("keeps an ordinary in-app path", () => {
    expect(safeReturnTo("/quotes/92")).toBe("/quotes/92");
  });

  it("keeps the query string, which is the whole point of preserving it", () => {
    expect(safeReturnTo("/settings?tab=integrations&email=connected")).toBe(
      "/settings?tab=integrations&email=connected",
    );
  });

  it("refuses an absolute URL to another site", () => {
    expect(safeReturnTo("https://elsewhere.example/phish")).toBe("/");
  });

  it("refuses a protocol-relative URL, which is the same trick", () => {
    expect(safeReturnTo("//elsewhere.example/phish")).toBe("/");
  });

  it("refuses a javascript: payload", () => {
    expect(safeReturnTo("javascript:alert(1)")).toBe("/");
  });

  it("falls back home when there is nothing to return to", () => {
    expect(safeReturnTo(null)).toBe("/");
    expect(safeReturnTo("")).toBe("/");
  });
});
