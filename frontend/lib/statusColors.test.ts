import { describe, it, expect } from "vitest";
import { statusColor, STATUS_COLORS, STATUS_COLOR_TOKENS } from "./statusColors";

describe("statusColor", () => {
  it("returns the class set for a known token", () => {
    expect(statusColor("green")).toBe(STATUS_COLORS.green);
    expect(statusColor("green").pill).toContain("green");
    expect(statusColor("green").header).toContain("bg-green-500");
  });

  it("falls back to slate for unknown / empty / null", () => {
    expect(statusColor("not-a-colour")).toBe(STATUS_COLORS.slate);
    expect(statusColor("")).toBe(STATUS_COLORS.slate);
    expect(statusColor(undefined)).toBe(STATUS_COLORS.slate);
    expect(statusColor(null)).toBe(STATUS_COLORS.slate);
  });

  it("exposes every token in the palette", () => {
    expect(STATUS_COLOR_TOKENS.length).toBeGreaterThan(5);
    for (const t of STATUS_COLOR_TOKENS) {
      expect(statusColor(t).dot).toContain(t === "gray" || t === "slate" ? t : t);
    }
  });
});
