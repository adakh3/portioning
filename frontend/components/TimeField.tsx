"use client";

import { useState, useEffect } from "react";

const HOURS_24 = Array.from({ length: 24 }, (_, i) => String(i).padStart(2, "0"));
const HOURS_12 = Array.from({ length: 12 }, (_, i) => String(i + 1)); // 1..12
const MINUTES = Array.from({ length: 60 }, (_, i) => String(i).padStart(2, "0"));

const selectClass =
  "flex h-9 rounded-md border border-input bg-transparent px-2 py-1 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:opacity-50";

// 24h "HH" -> {h12, period}; and back.
function to12(h24: string): { h12: string; period: "AM" | "PM" } {
  const n = parseInt(h24, 10);
  if (isNaN(n)) return { h12: "", period: "AM" };
  return { h12: String(n % 12 === 0 ? 12 : n % 12), period: n < 12 ? "AM" : "PM" };
}
function to24(h12: string, period: string): string {
  const n = parseInt(h12, 10);
  if (isNaN(n)) return "";
  const h = (n % 12) + (period === "PM" ? 12 : 0);
  return String(h).padStart(2, "0");
}

/** A single optional time value, entered as dropdowns. The stored value is always
 * 24-hour "HH:MM" (or ""); the org's `format` only changes how it's ENTERED —
 * "12h" shows hour 1–12 + minute + AM/PM, "24h" shows hour 0–23 + minute. Empty
 * shows an explicit "Add time" button so a blank field is never mistaken for set.
 * Deliberately not a native <input type="time"> (Safari drops its onChange). */
export default function TimeField({
  value,
  onChange,
  ariaLabel,
  disabled = false,
  format = "24h",
}: {
  value: string;
  onChange: (v: string) => void;
  ariaLabel: string;
  disabled?: boolean;
  format?: "12h" | "24h";
}) {
  const [adding, setAdding] = useState(false);
  const [h, setH] = useState(() => (value.includes(":") ? value.split(":")[0] : ""));
  const [m, setM] = useState(() => (value.includes(":") ? value.split(":")[1] : ""));
  useEffect(() => {
    if (value.includes(":")) {
      const [vh, vm] = value.split(":");
      setH(vh);
      setM(vm);
    }
  }, [value]);

  if (!value && !adding) {
    return (
      <button
        type="button"
        disabled={disabled}
        aria-label={`Set ${ariaLabel}`}
        onClick={() => setAdding(true)}
        className="flex h-9 w-full items-center rounded-md border border-dashed border-input px-3 text-sm text-muted-foreground hover:bg-accent hover:text-foreground disabled:opacity-50"
      >
        + Add time
      </button>
    );
  }

  const commit = (nh: string, nm: string) => {
    setH(nh);
    setM(nm);
    onChange(nh && nm ? `${nh}:${nm}` : "");
  };

  const is12 = format === "12h";
  const { h12, period } = to12(h);

  return (
    <div className="flex items-center gap-1">
      <select
        aria-label={`${ariaLabel} hour`}
        value={is12 ? h12 : h}
        disabled={disabled}
        onChange={(e) => commit(is12 ? to24(e.target.value, period) : e.target.value, m)}
        className={selectClass}
      >
        <option value="">HH</option>
        {(is12 ? HOURS_12 : HOURS_24).map((x) => <option key={x} value={x}>{x}</option>)}
      </select>
      <span className="text-muted-foreground">:</span>
      <select
        aria-label={`${ariaLabel} minute`}
        value={m}
        disabled={disabled}
        onChange={(e) => commit(h, e.target.value)}
        className={selectClass}
      >
        <option value="">MM</option>
        {MINUTES.map((x) => <option key={x} value={x}>{x}</option>)}
      </select>
      {is12 && (
        <select
          aria-label={`${ariaLabel} AM/PM`}
          value={period}
          disabled={disabled}
          onChange={(e) => commit(to24(h12, e.target.value), m)}
          className={selectClass}
        >
          <option value="AM">AM</option>
          <option value="PM">PM</option>
        </select>
      )}
      {!disabled && (
        <button
          type="button"
          aria-label={`Clear ${ariaLabel}`}
          onClick={() => { setH(""); setM(""); setAdding(false); onChange(""); }}
          className="px-1 text-sm text-muted-foreground hover:text-foreground"
        >
          ✕
        </button>
      )}
    </div>
  );
}
