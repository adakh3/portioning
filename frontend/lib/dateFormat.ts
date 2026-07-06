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
  return FORMAT_CONFIG[dateFormat] || FORMAT_CONFIG["DD/MM/YYYY"];
}

/** Format a date string (ISO/date) as date only — e.g. "10/03/2026" or "14 Mar 2026" */
export function formatDate(dateStr: string, dateFormat: string): string {
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
