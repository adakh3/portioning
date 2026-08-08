/** Today's date as a local "YYYY-MM-DD" string (for <input type="date"> defaults
 * and anchoring times). Uses local parts, not UTC, so it doesn't roll over late
 * in the day. */
export function todayISO(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

interface FormatConfig {
  locale: string;
  dateOptions: Intl.DateTimeFormatOptions;
}

const FORMAT_CONFIG: Record<string, FormatConfig> = {
  "DD/MM/YYYY": {
    locale: "en-GB",
    dateOptions: { day: "2-digit", month: "2-digit", year: "numeric" },
  },
  "MM/DD/YYYY": {
    locale: "en-US",
    dateOptions: { day: "2-digit", month: "2-digit", year: "numeric" },
  },
  "YYYY-MM-DD": {
    locale: "sv-SE",
    dateOptions: { day: "2-digit", month: "2-digit", year: "numeric" },
  },
  "DD MMM YYYY": {
    locale: "en-GB",
    dateOptions: { day: "2-digit", month: "short", year: "numeric" },
  },
  "DD MMM YY": {
    locale: "en-GB",
    dateOptions: { day: "2-digit", month: "short", year: "2-digit" },
  },
  "MMM DD, YYYY": {
    locale: "en-US",
    dateOptions: { day: "2-digit", month: "short", year: "numeric" },
  },
};

function getConfig(dateFormat: string): FormatConfig {
  return FORMAT_CONFIG[dateFormat] || FORMAT_CONFIG["MM/DD/YYYY"];
}

/**
 * A **calendar date** — an event date, a valid-until, a due date. Formatted in
 * **UTC**, deliberately.
 *
 * `new Date("2026-03-10")` — a bare date, which is what a Django `DateField`
 * serializes to — is parsed by JS as UTC midnight. Rendering that in the viewer's
 * zone moves it BACKWARDS anywhere west of Greenwich, so an event on the 10th
 * displayed as the 9th in New York, Chicago and Los Angeles. UTC and London did
 * not, which is why it survived: CI runs UTC.
 *
 * A calendar date does not move when the reader does. Use this for anything a
 * `DateField` holds. For a **timestamp** — `created_at`, `sent_at`, an audit
 * moment — use {@link formatInstantDate}: "which day was that?" is legitimately a
 * question about where the reader is.
 */
export function formatDate(dateStr: string, dateFormat: string): string {
  if (!dateStr) return "-";
  const d = new Date(dateStr);
  if (isNaN(d.getTime())) return dateStr;
  const { locale, dateOptions } = getConfig(dateFormat);
  return new Intl.DateTimeFormat(locale, { ...dateOptions, timeZone: "UTC" }).format(d);
}

/**
 * The date part of a **timestamp** — `created_at`, `sent_at`, `accepted_at`.
 * Formatted in the **viewer's** zone, deliberately, and the mirror image of
 * {@link formatDate}.
 *
 * These are true instants set server-side by `timezone.now()`, so the calendar day
 * they fall on genuinely depends on where you are: a quote created at
 * `2026-03-10T01:30:00Z` was created on the **9th** for a caterer in New York, and
 * telling them it was the 10th would be telling them it happened tomorrow. It also
 * keeps this consistent with `formatDateTime`, which renders the same field's full
 * timestamp locally — the two must not name different days for one value.
 */
export function formatInstantDate(dateStr: string, dateFormat: string): string {
  if (!dateStr) return "-";
  const d = new Date(dateStr);
  if (isNaN(d.getTime())) return dateStr;
  const { locale, dateOptions } = getConfig(dateFormat);
  return new Intl.DateTimeFormat(locale, dateOptions).format(d);
}

/** Format a date string (ISO/datetime) as date + time. `timeFormat` ("12h"/"24h")
 * controls AM/PM vs 24-hour; defaults to 24h to preserve existing callers. */
export function formatDateTime(dateStr: string, dateFormat: string, timeFormat: string = "24h"): string {
  if (!dateStr) return "-";
  const d = new Date(dateStr);
  if (isNaN(d.getTime())) return dateStr;
  const { locale, dateOptions } = getConfig(dateFormat);
  return new Intl.DateTimeFormat(locale, {
    ...dateOptions,
    hour: "2-digit",
    minute: "2-digit",
    hour12: timeFormat === "12h",
  }).format(d);
}

/** Format a bare time — an "HH:MM"/"HH:MM:SS" string or a datetime — per the org's
 * 12h/24h preference. "19:00" → "7:00 PM" (12h) or "19:00" (24h). */
export function formatTime(value: string, timeFormat: string = "24h"): string {
  if (!value) return "";
  const t = value.includes("T") ? value.slice(11, 16) : value.slice(0, 5);
  const [hs, ms] = t.split(":");
  const h = parseInt(hs, 10);
  const m = parseInt(ms, 10);
  if (isNaN(h) || isNaN(m)) return value;
  if (timeFormat === "12h") {
    const period = h < 12 ? "AM" : "PM";
    const h12 = h % 12 === 0 ? 12 : h % 12;
    return `${h12}:${String(m).padStart(2, "0")} ${period}`;
  }
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}
