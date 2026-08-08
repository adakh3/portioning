"use client";

import { ValidatedInput } from "@/components/ui/validated-input";
import { useSiteSettings } from "@/lib/hooks";
import { defaultSegmentRemainder, GuestSegmentMeta } from "@/lib/bookingPayload";

export interface GuestCountValue {
  guest_count: number; // THE number — canonical, drives money and displays
  segment_counts: Record<string, number>; // explicit per-segment inputs; the org's
  // default segment is never entered here — it's the derived remainder.
  segment_prices: Record<string, string>; // per-segment per-head overrides; blank = the
  // multiplier default. The default segment (Adults) always uses the base price/head.
  big_eaters: boolean;
  big_eaters_percentage: number;
}

/** Sorted org segments from settings, split into the three UI groups. */
export function groupSegments(segments: GuestSegmentMeta[]) {
  const byOrder = [...segments].sort((a, b) => a.sort_order - b.sort_order);
  const inCount = byOrder.filter((s) => s.counts_toward_total);
  return {
    defaultSeg: inCount.find((s) => s.is_default) ?? null,
    explicitInCount: inCount.filter((s) => !s.is_default),
    additional: byOrder.filter((s) => !s.counts_toward_total),
  };
}

/** True when the explicit in-count segments don't exceed the guest count
 * (remainder ≥ 0). The only breakdown validation (AC3). */
export function breakdownValid(v: GuestCountValue, segments: GuestSegmentMeta[]): boolean {
  return defaultSegmentRemainder(v.guest_count || 0, v.segment_counts || {}, segments) >= 0;
}

/**
 * The shared guest field, count-first for ALL orgs (REL-415): a canonical Guest
 * Count, an optional breakdown where every in-count segment except the org default
 * is an explicit input and the default is the derived read-only remainder, and a
 * separate "Additional covers" section for segments that aren't part of the guest
 * count (e.g. Vendors). No org-type branching — the org's segment DATA drives it.
 * Used by both the quote and event editors so guests are entered identically.
 */
export default function GuestCountField({
  value,
  onChange,
  disabled = false,
}: {
  value: GuestCountValue;
  onChange: (patch: Partial<GuestCountValue>) => void;
  disabled?: boolean;
}) {
  const { data: settings } = useSiteSettings();
  const segments = (settings?.guest_segments ?? []) as GuestSegmentMeta[];
  const total = value.guest_count || 0;
  const counts = value.segment_counts || {};
  const { defaultSeg, explicitInCount, additional } = groupSegments(segments);
  const remainder = defaultSegmentRemainder(total, counts, segments);

  const setCount = (name: string, raw: number) =>
    onChange({ segment_counts: { ...counts, [name]: Math.max(0, raw || 0) } });

  const labelCls = "block text-sm font-medium text-foreground mb-1";

  /** One segment = one bounded cell: its name and its count (REL-428).
   *
   * Per-head RATES deliberately do not live here. This card is filled in before the
   * menu is priced, so any rate shown here is a number that cannot be known yet —
   * and the auto-fill writes "0.00" the moment a template loads, which read as a
   * statement that the guests were priced at nothing. Rates now sit in Menu &
   * Pricing beside the Price/head they derive from: see SegmentRatesField. */
  const segmentCell = (s: GuestSegmentMeta, countControl: React.ReactNode) => (
    <div key={s.name} className="rounded-lg border border-border/70 bg-muted/20 p-3">
      <label className={labelCls}>{s.name}</label>
      {countControl}
    </div>
  );

  /** The default segment's count: the derived remainder, clearly not a field (AC4).
   * `h-9` matches the Input default so this column doesn't run taller than the
   * editable ones — the ragged grid is the whole reason this ticket exists. */
  const derivedCountBox = (s: GuestSegmentMeta) => (
    <div
      aria-label={`${s.name} (derived)`}
      className="flex h-9 items-center rounded-md border border-input bg-muted/50 px-3 text-sm text-muted-foreground"
    >
      {Math.max(0, remainder)}
      <span className="ml-1.5 text-xs">(auto)</span>
    </div>
  );

  const countInput = (s: GuestSegmentMeta, max: number) => (
    <ValidatedInput
      type="number" min={0} max={max} disabled={disabled}
      aria-label={s.name}
      value={counts[s.name] ?? ""}
      onChange={(e) => setCount(s.name, Number(e.target.value))}
    />
  );

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
        <div>
          <label className={labelCls}>Guest Count</label>
          <ValidatedInput
            type="number" min={1} max={100000} disabled={disabled}
            aria-label="Guest Count"
            value={total || ""}
            onChange={(e) => onChange({ guest_count: Math.max(0, Number(e.target.value) || 0) })}
          />
        </div>
      </div>

      {/* Optional in-count breakdown; the default segment is the derived remainder. */}
      {explicitInCount.length > 0 && total > 0 && (
        <div className="space-y-2">
          <p className="text-sm font-medium text-foreground">Breakdown (optional)</p>
          <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
            {explicitInCount.map((s) => segmentCell(s, countInput(s, total)))}
            {defaultSeg && segmentCell(defaultSeg, derivedCountBox(defaultSeg))}
          </div>
          {remainder < 0 && (
            <p className="text-xs text-destructive">
              The breakdown ({total - remainder}) is more than the guest count ({total}).
            </p>
          )}
        </div>
      )}

      {/* Additional covers — fed but not part of the guest count / guarantee. */}
      {additional.length > 0 && (
        <div className="space-y-2">
          <p className="text-sm font-medium text-foreground">Additional covers (not in guest count)</p>
          {/* Same cell as the in-count breakdown — extra covers have the identical
              name/count shape, so they get the identical treatment (AC7). */}
          <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
            {additional.map((s) => segmentCell(s, countInput(s, 100000)))}
          </div>
          <p className="text-xs text-muted-foreground">
            Serving vendors a different menu? Add it as a separate meal instead.
          </p>
        </div>
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
