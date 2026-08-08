import { describe, it, expect } from "vitest";
import { formatDate, formatInstantDate, formatDateTime } from "./dateFormat";

describe("formatDate", () => {
  // A booking's date is a CALENDAR DATE, not an instant: it must not move when the
  // reader does. `new Date("2026-03-10")` is UTC midnight, so formatting it in the
  // viewer's zone shifts it backwards anywhere west of Greenwich — every booking
  // date read a day early in New York, Chicago and Los Angeles, while UTC and
  // London (and therefore CI) looked fine.
  //
  // These CANNOT catch it on their own when the suite runs in UTC — there, local
  // time IS UTC, so the conversion is a no-op and every assertion below passes with
  // the bug fully present (measured, not assumed). The timezone the suite runs in
  // is the actual gate, which is why CI runs the whole suite a second time in
  // America/New_York. Keep these anyway: under that second run they name the rule
  // that broke, instead of leaving someone to infer it from seven format tests.
  it("a bare date renders as itself, whatever zone the reader is in", () => {
    // Would render "09 Mar 2026" west of Greenwich if the local zone were used.
    expect(formatDate("2026-03-10", "DD MMM YYYY")).toBe("10 Mar 2026");
  });

  it("an early-morning UTC datetime does not roll back west of Greenwich", () => {
    // Discriminating in America/New_York (CI's second run): local 19:30 on the 9th.
    expect(formatDate("2026-03-10T00:30:00Z", "DD MMM YYYY")).toBe("10 Mar 2026");
  });

  // The mirror rule. `formatDate` is for CALENDAR dates and must not move with the
  // reader; `formatInstantDate` is for TIMESTAMPS and must. Fixing the first by
  // pinning everything to UTC silently broke the second — a quote created at
  // 01:30Z read as "created tomorrow" to a caterer in New York, and disagreed with
  // the same field's own formatDateTime tooltip two lines away.
  it("formatInstantDate DOES follow the reader — an instant's day is a local question", () => {
    // 01:30Z on the 10th is 21:30 on the 9th in New York, and 14:30 on the 10th in
    // Auckland. Asserted as "whatever the local day is", so it discriminates in
    // every zone CI runs without hardcoding one of them.
    const iso = "2026-03-10T01:30:00Z";
    const localDay = new Date(iso).getDate();
    expect(formatInstantDate(iso, "DD MMM YYYY")).toContain(String(localDay).padStart(2, "0"));
  });

  it("the two disagree exactly when the reader's zone shifts the day", () => {
    const iso = "2026-03-10T01:30:00Z";
    const sameDay = new Date(iso).getUTCDate() === new Date(iso).getDate();
    const cal = formatDate(iso, "DD MMM YYYY");
    const inst = formatInstantDate(iso, "DD MMM YYYY");
    expect(cal).toBe("10 Mar 2026");
    if (sameDay) expect(inst).toBe(cal);
    else expect(inst).not.toBe(cal);
  });

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

  it("falls back to MM/DD/YYYY (US-generic) for unknown format", () => {
    const result = formatDate("2026-03-10", "UNKNOWN");
    expect(result).toBe("03/10/2026");
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
