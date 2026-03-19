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

/** Format a date string (ISO/datetime) as date + time — e.g. "10/03/2026, 14:30" */
export function formatDateTime(dateStr: string, dateFormat: string): string {
  if (!dateStr) return "-";
  const d = new Date(dateStr);
  if (isNaN(d.getTime())) return dateStr;
  const { locale, dateOptions } = getConfig(dateFormat);
  return new Intl.DateTimeFormat(locale, {
    ...dateOptions,
    hour: "2-digit",
    minute: "2-digit",
  }).format(d);
}
