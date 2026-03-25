import { describe, it, expect } from "vitest";
import { cn, formatCurrency } from "./utils";

describe("cn", () => {
  it("merges class names", () => {
    expect(cn("px-2", "py-1")).toBe("px-2 py-1");
  });

  it("resolves tailwind conflicts (last wins)", () => {
    expect(cn("px-2", "px-4")).toBe("px-4");
  });

  it("handles conditional classes", () => {
    expect(cn("base", false && "hidden", "extra")).toBe("base extra");
  });

  it("returns empty string for no inputs", () => {
    expect(cn()).toBe("");
  });
});

describe("formatCurrency", () => {
  it("formats a number with default symbol and decimals", () => {
    const result = formatCurrency(1234.5);
    expect(result).toMatch(/^£1[,.]234\.50$/);
  });

  it("formats a numeric string", () => {
    const result = formatCurrency("99.9");
    expect(result).toMatch(/^£99\.90$/);
  });

  it("handles zero", () => {
    const result = formatCurrency(0);
    expect(result).toMatch(/^£0\.00$/);
  });

  it("handles NaN input gracefully", () => {
    expect(formatCurrency(NaN)).toBe("£0.00");
  });

  it("handles non-numeric string gracefully", () => {
    expect(formatCurrency("abc")).toBe("£0.00");
  });

  it("uses custom currency symbol", () => {
    const result = formatCurrency(50, "$");
    expect(result).toMatch(/^\$50\.00$/);
  });

  it("uses custom decimal places", () => {
    const result = formatCurrency(10, "£", 0);
    expect(result).toBe("£10");
  });
});
