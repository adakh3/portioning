"use client";

import { ValidatedInput } from "@/components/ui/validated-input";
import { useSiteSettings } from "@/lib/hooks";

export interface GuestCountValue {
  guest_count: number;             // THE number — drives money and displays
  gents: number;                   // optional split; 0/0 = not specified
  ladies: number;
  custom_split: boolean;           // UI: the split section is open
  big_eaters: boolean;
  big_eaters_percentage: number;
}

/** True when the split is absent or adds up to the guest count. */
export function splitAddsUp(v: Pick<GuestCountValue, "guest_count" | "gents" | "ladies" | "custom_split">) {
  if (!v.custom_split) return true;
  return v.gents + v.ladies === v.guest_count;
}

/** The shared guest field: a Guest Count input (the canonical number), an optional
 * gents/ladies split that must add up to it, and a Big Eaters modifier. Changing
 * the count clears an entered split — we never scale numbers the user didn't type.
 * Used by both the quote and event editors so guests are entered identically. */
export default function GuestCountField({
  value,
  onChange,
  disabled = false,
}: {
  value: GuestCountValue;
  onChange: (patch: Partial<GuestCountValue>) => void;
  disabled?: boolean;
}) {
  const total = value.guest_count || 0;
  const splitTotal = (value.gents || 0) + (value.ladies || 0);
  const addsUp = splitTotal === total;

  // Show the legacy gents/ladies split ONLY for orgs whose in-count segments are
  // exactly Gents + Ladies (the only shape this split UI can faithfully express).
  // US orgs (Adults/Kids/Vendors) get a plain single count; the N-segment
  // breakdown UI ships in Wave 2a. Until settings load, default to showing it so
  // existing gents/ladies orgs never regress.
  const { data: settings } = useSiteSettings();
  const segments = settings?.guest_segments;
  const inCount = (segments ?? []).filter((s) => s.counts_toward_total).map((s) => s.name.toLowerCase());
  const showSplit = segments === undefined
    || (inCount.length === 2 && inCount.includes("gents") && inCount.includes("ladies"));

  const setTotal = (raw: number) => {
    const t = Math.max(0, raw || 0);
    // The split was for the old number — clear it and ask again.
    onChange({ guest_count: t, gents: 0, ladies: 0, custom_split: false });
  };

  const toggleCustom = (custom: boolean) => {
    if (custom) {
      // Open with a suggested even split; the user confirms/adjusts it.
      onChange({ custom_split: true, gents: Math.ceil(total / 2), ladies: Math.floor(total / 2) });
    } else {
      onChange({ custom_split: false, gents: 0, ladies: 0 });
    }
  };

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
        <div>
          <label className="block text-sm font-medium text-foreground mb-1">Guest Count</label>
          <ValidatedInput
            type="number" min={1} max={100000} disabled={disabled}
            aria-label="Guest Count"
            value={total || ""}
            onChange={(e) => setTotal(Number(e.target.value))}
          />
        </div>
        {showSplit && (
          <div className="flex items-end pb-1">
            <label className="flex items-center gap-2 text-sm text-foreground cursor-pointer">
              <input
                type="checkbox" checked={value.custom_split} disabled={disabled}
                onChange={(e) => toggleCustom(e.target.checked)}
                className="rounded border-input"
              />
              Gents / ladies split
            </label>
          </div>
        )}
      </div>
      {showSplit && value.custom_split ? (
        <div>
          <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
            <div>
              <label className="block text-sm font-medium text-foreground mb-1">Gents</label>
              <ValidatedInput
                type="number" min={0} max={total} disabled={disabled}
                aria-label="Gents"
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
                aria-label="Ladies"
                value={value.ladies}
                onChange={(e) => {
                  const ladies = Math.max(0, Number(e.target.value) || 0);
                  onChange({ ladies, gents: Math.max(0, total - ladies) });
                }}
              />
            </div>
          </div>
          <p className={`text-xs mt-1 ${addsUp ? "text-muted-foreground" : "text-destructive"}`}>
            {addsUp
              ? `✓ adds up to ${total}`
              : `Gents + ladies must add up to ${total} (currently ${splitTotal})`}
          </p>
        </div>
      ) : (
        total > 0 && (
          <p className="text-xs text-muted-foreground">Split: not specified</p>
        )
      )}
      <div className="flex items-end pb-1">
        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox" checked={value.big_eaters} disabled={disabled}
            onChange={(e) => onChange({ big_eaters: e.target.checked })}
            className="rounded border-input text-primary focus:ring-ring"
          />
          <span className="font-medium text-foreground">Hearty eaters</span>
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
      <p className="text-xs text-muted-foreground -mt-0.5">
        Increase all portions by a set percentage (default 20%) for a crowd with
        bigger appetites (athletes, teens, BBQ events).
      </p>
    </div>
  );
}
