"use client";

import { formatTime } from "@/lib/dateFormat";

const selectClass =
  "flex h-9 w-full rounded-md border border-input bg-transparent px-2 py-1 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:opacity-50";

// 15-minute slots across the day: "00:00", "00:15", … "23:45" (24h internal).
// Quarter-hours, not half: a real run-of-show is full of them — "3:45 chill the
// champagne", "4:45 ballroom set by", "6:15 begin dinner service" — and a
// half-hour grid simply can't express those.
const SLOTS: string[] = (() => {
  const out: string[] = [];
  for (let h = 0; h < 24; h++) {
    for (const m of ["00", "15", "30", "45"]) out.push(`${String(h).padStart(2, "0")}:${m}`);
  }
  return out;
})();

/** A single optional time value, entered as ONE dropdown of 15-minute slots. The
 * stored value is always 24-hour "HH:MM" (or ""); the org's `format` only changes
 * how each slot is LABELLED ("7:00 PM" vs "19:00"). A stored time that isn't on a
 * 15-minute boundary (e.g. an imported 07:05) is kept as an extra option so editing
 * never silently drops it. Deliberately not a native <input type="time">: Safari
 * doesn't reliably fire its onChange, and it ignores the org's 12h/24h setting. */
export default function TimeField({
  value,
  onChange,
  ariaLabel,
  disabled = false,
  format = "24h",
  allowEmpty = true,
}: {
  value: string;
  onChange: (v: string) => void;
  ariaLabel: string;
  disabled?: boolean;
  format?: "12h" | "24h";
  /** Offer "— Not set —". Off where an empty time would destroy the row it
   * belongs to (a run-of-show step is nothing without its time). */
  allowEmpty?: boolean;
}) {
  const options = value && !SLOTS.includes(value) ? [value, ...SLOTS] : SLOTS;
  return (
    <select
      aria-label={ariaLabel}
      value={value}
      disabled={disabled}
      onChange={(e) => onChange(e.target.value)}
      className={selectClass}
    >
      {allowEmpty && <option value="">— Not set —</option>}
      {options.map((s) => (
        <option key={s} value={s}>{formatTime(s, format)}</option>
      ))}
    </select>
  );
}
