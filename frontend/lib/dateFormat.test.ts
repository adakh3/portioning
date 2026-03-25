import { describe, it, expect } from "vitest";
import { formatDate, formatDateTime } from "./dateFormat";

describe("formatDate", () => {
  it("returns '-' for empty string", () => {
    expect(formatDate("", "DD/MM/YYYY")).toBe("-");
  });

  it("returns original string for invalid date", () => {
    expect(formatDate("not-a-date", "DD/MM/YYYY")).toBe("not-a-date");
  });

  it("formats DD/MM/YYYY", () => {
    const result = formatDate("2026-03-10", "DD/MM/YYYY");
    expect(result).toBe("10/03/2026");
  });

  it("formats MM/DD/YYYY", () => {
    const result = formatDate("2026-03-10", "MM/DD/YYYY");
    expect(result).toBe("03/10/2026");
  });

  it("formats YYYY-MM-DD", () => {
    const result = formatDate("2026-03-10", "YYYY-MM-DD");
    expect(result).toBe("2026-03-10");
  });

  it("formats DD MMM YYYY", () => {
    const result = formatDate("2026-03-10", "DD MMM YYYY");
    expect(result).toMatch(/10 Mar 2026/);
  });

  it("formats DD MMM YY", () => {
    const result = formatDate("2026-03-10", "DD MMM YY");
    expect(result).toMatch(/10 Mar 26/);
  });

  it("formats MMM DD, YYYY", () => {
    const result = formatDate("2026-03-10", "MMM DD, YYYY");
    expect(result).toMatch(/Mar 10, 2026/);
  });

  it("falls back to DD/MM/YYYY for unknown format", () => {
    const result = formatDate("2026-03-10", "UNKNOWN");
    expect(result).toBe("10/03/2026");
  });
});

describe("formatDateTime", () => {
  it("returns '-' for empty string", () => {
    expect(formatDateTime("", "DD/MM/YYYY")).toBe("-");
  });

  it("returns original string for invalid date", () => {
    expect(formatDateTime("garbage", "DD/MM/YYYY")).toBe("garbage");
  });

  it("includes time in output", () => {
    const result = formatDateTime("2026-03-10T14:30:00Z", "DD/MM/YYYY");
    expect(result).toMatch(/\d{2}:\d{2}/);
  });
});
