"use client";

import { ValidatedInput } from "@/components/ui/validated-input";

export interface GuestCountValue {
  gents: number;
  ladies: number;
  custom_split: boolean;           // UI-only: edit gents/ladies directly vs auto 50/50
  big_eaters: boolean;
  big_eaters_percentage: number;
}

/** The shared guest-count field: a Total Guests input, an optional Customise-split
 * into gents/ladies, and a Big Eaters modifier. Controlled — the canonical value
 * is gents/ladies (total is derived). Used by both the quote and event editors so
 * guests are entered identically. */
export default function GuestCountField({
  value,
  onChange,
  disabled = false,
}: {
  value: GuestCountValue;
  onChange: (patch: Partial<GuestCountValue>) => void;
  disabled?: boolean;
}) {
  const total = (value.gents || 0) + (value.ladies || 0);

  const setTotal = (raw: number) => {
    const t = Math.max(0, raw || 0);
    if (value.custom_split) {
      // Keep the current gents:ladies ratio when the total changes.
      const ratio = total > 0 ? value.gents / total : 0.5;
      const gents = Math.round(t * ratio);
      onChange({ gents, ladies: t - gents });
    } else {
      onChange({ gents: Math.ceil(t / 2), ladies: Math.floor(t / 2) });
    }
  };

  const toggleCustom = (custom: boolean) => {
    if (custom) onChange({ custom_split: true });
    else onChange({ custom_split: false, gents: Math.ceil(total / 2), ladies: Math.floor(total / 2) });
  };

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
        <div>
          <label className="block text-sm font-medium text-foreground mb-1">Total Guests</label>
          <ValidatedInput
            type="number" min={1} max={100000} disabled={disabled}
            value={total || ""}
            onChange={(e) => setTotal(Number(e.target.value))}
          />
        </div>
        <div className="flex items-end pb-1">
          <label className="flex items-center gap-2 text-sm text-foreground cursor-pointer">
            <input
              type="checkbox" checked={value.custom_split} disabled={disabled}
              onChange={(e) => toggleCustom(e.target.checked)}
              className="rounded border-input"
            />
            Customise split
          </label>
        </div>
      </div>
      {value.custom_split && (
        <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
          <div>
            <label className="block text-sm font-medium text-foreground mb-1">Gents</label>
            <ValidatedInput
              type="number" min={0} max={total} disabled={disabled}
              value={value.gents}
              onChange={(e) => {
                const gents = Math.max(0, Number(e.target.value) || 0);
                onChange({ gents, ladies: Math.max(0, total - gents) });
              }}
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-foreground mb-1">Ladies</label>
            <ValidatedInput
              type="number" min={0} max={total} disabled={disabled}
              value={value.ladies}
              onChange={(e) => {
                const ladies = Math.max(0, Number(e.target.value) || 0);
                onChange({ ladies, gents: Math.max(0, total - ladies) });
              }}
            />
          </div>
        </div>
      )}
      {!value.custom_split && total > 0 && (
        <p className="text-xs text-muted-foreground">
          Split: {Math.ceil(total / 2)} gents / {Math.floor(total / 2)} ladies
        </p>
      )}
      <div className="flex items-end pb-1">
        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox" checked={value.big_eaters} disabled={disabled}
            onChange={(e) => onChange({ big_eaters: e.target.checked })}
            className="rounded border-input text-primary focus:ring-ring"
          />
          <span className="font-medium text-foreground">Big Eaters</span>
        </label>
        {value.big_eaters && (
          <div className="ml-4 flex items-center gap-1.5">
            <ValidatedInput
              type="number" min={0} max={100} disabled={disabled}
              value={value.big_eaters_percentage}
              onChange={(e) => onChange({ big_eaters_percentage: Number(e.target.value) })}
              className="w-20 h-8"
            />
            <span className="text-xs text-muted-foreground">%</span>
          </div>
        )}
      </div>
    </div>
  );
}
