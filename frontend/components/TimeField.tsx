"use client";

import { useState, useEffect } from "react";

const HOURS = Array.from({ length: 24 }, (_, i) => String(i).padStart(2, "0"));
const MINUTES = Array.from({ length: 60 }, (_, i) => String(i).padStart(2, "0"));

const selectClass =
  "flex h-9 rounded-md border border-input bg-transparent px-2 py-1 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:opacity-50";

/** A single optional time value, entered as hour + minute dropdowns. Deliberately
 * NOT a native <input type="time">: Safari doesn't reliably fire React's onChange
 * for it, so entered times were silently lost. Empty shows an explicit "Add time"
 * button so a blank field is never mistaken for a set one. `value` is "HH:MM" or
 * ""; onChange emits "HH:MM" (both parts chosen) or "" (cleared/incomplete). */
export default function TimeField({
  value,
  onChange,
  ariaLabel,
  disabled = false,
}: {
  value: string;
  onChange: (v: string) => void;
  ariaLabel: string;
  disabled?: boolean;
}) {
  const [adding, setAdding] = useState(false);
  // Seed the dropdowns from the value once; the user's edits drive it after that.
  const [h, setH] = useState(() => (value.includes(":") ? value.split(":")[0] : ""));
  const [m, setM] = useState(() => (value.includes(":") ? value.split(":")[1] : ""));
  // Sync from the value when it changes externally (e.g. loading a record) — but
  // only for a COMPLETE time, so a mid-entry "" (hour picked, minute not) doesn't
  // wipe the hour the user just chose.
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

  return (
    <div className="flex items-center gap-1">
      <select
        aria-label={`${ariaLabel} hour`}
        value={h}
        disabled={disabled}
        onChange={(e) => commit(e.target.value, m)}
        className={selectClass}
      >
        <option value="">HH</option>
        {HOURS.map((x) => <option key={x} value={x}>{x}</option>)}
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
