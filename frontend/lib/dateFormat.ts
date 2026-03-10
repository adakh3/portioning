const LOCALE_MAP: Record<string, string> = {
  "DD/MM/YYYY": "en-GB",
  "MM/DD/YYYY": "en-US",
  "YYYY-MM-DD": "sv-SE",
};

function getLocale(dateFormat: string): string {
  return LOCALE_MAP[dateFormat] || "en-GB";
}

/** Format a date string (ISO/date) as date only — e.g. "10/03/2026" or "03/10/2026" */
export function formatDate(dateStr: string, dateFormat: string): string {
  if (!dateStr) return "-";
  const d = new Date(dateStr);
  if (isNaN(d.getTime())) return dateStr;
  return new Intl.DateTimeFormat(getLocale(dateFormat), {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  }).format(d);
}

/** Format a date string (ISO/datetime) as date + time — e.g. "10/03/2026, 14:30" */
export function formatDateTime(dateStr: string, dateFormat: string): string {
  if (!dateStr) return "-";
  const d = new Date(dateStr);
  if (isNaN(d.getTime())) return dateStr;
  return new Intl.DateTimeFormat(getLocale(dateFormat), {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(d);
}
