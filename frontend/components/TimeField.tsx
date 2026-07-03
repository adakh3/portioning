"use client";

import { useState } from "react";
import { ValidatedInput } from "@/components/ui/validated-input";

/** A single optional time value. When empty it shows an explicit "Add time"
 * button (so a blank field can never be mistaken for a set one — native
 * <input type="time"> renders a misleading placeholder that looks like a real
 * time). When set it shows the time plus a clear (✕). `value` is "HH:MM" or "";
 * onChange emits "HH:MM" or "" (cleared). */
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

  return (
    <div className="flex items-center gap-1">
      <ValidatedInput
        type="time"
        aria-label={ariaLabel}
        autoFocus={adding && !value}
        value={value}
        disabled={disabled}
        onChange={(e) => onChange(e.target.value)}
      />
      {!disabled && (
        <button
          type="button"
          aria-label={`Clear ${ariaLabel}`}
          onClick={() => { onChange(""); setAdding(false); }}
          className="px-1 text-sm text-muted-foreground hover:text-foreground"
        >
          ✕
        </button>
      )}
    </div>
  );
}
