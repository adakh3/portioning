"use client";

import { ValidatedInput } from "@/components/ui/validated-input";
import { useSiteSettings } from "@/lib/hooks";
import { defaultSegmentRemainder, segmentEffectiveRate, GuestSegmentMeta } from "@/lib/quoteTotals";

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
  pricePerHead,
}: {
  value: GuestCountValue;
  onChange: (patch: Partial<GuestCountValue>) => void;
  disabled?: boolean;
  pricePerHead?: string; // base per-head (Adults rate); seeds each segment's default rate
}) {
  const { data: settings } = useSiteSettings();
  const segments = (settings?.guest_segments ?? []) as GuestSegmentMeta[];
  const total = value.guest_count || 0;
  const counts = value.segment_counts || {};
  const prices = value.segment_prices || {};
  const { defaultSeg, explicitInCount, additional } = groupSegments(segments);
  const remainder = defaultSegmentRemainder(total, counts, segments);

  const setCount = (name: string, raw: number) =>
    onChange({ segment_counts: { ...counts, [name]: Math.max(0, raw || 0) } });
  const setPrice = (name: string, raw: string) =>
    onChange({ segment_prices: { ...prices, [name]: raw } });

  const labelCls = "block text-sm font-medium text-foreground mb-1";

  /** A per-head rate box for a non-default segment: default (base × multiplier)
   * shows as the placeholder; typing stores a flat/custom override. */
  const rateBox = (s: GuestSegmentMeta) => (
    <div className="mt-1.5 flex items-center gap-1.5">
      <span className="text-xs text-muted-foreground">$/head</span>
      <ValidatedInput
        type="number" step="0.01" min={0} disabled={disabled}
        aria-label={`${s.name} price per head`}
        placeholder={segmentEffectiveRate(pricePerHead, s.price_multiplier).toFixed(2)}
        value={prices[s.name] ?? ""}
        onChange={(e) => setPrice(s.name, e.target.value)}
        className="h-8"
      />
    </div>
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
            {explicitInCount.map((s) => (
              <div key={s.name}>
                <label className={labelCls}>{s.name}</label>
                <ValidatedInput
                  type="number" min={0} max={total} disabled={disabled}
                  aria-label={s.name}
                  value={counts[s.name] ?? ""}
                  onChange={(e) => setCount(s.name, Number(e.target.value))}
                />
                {rateBox(s)}
              </div>
            ))}
            {defaultSeg && (
              <div>
                <label className={labelCls}>{defaultSeg.name}</label>
                <div
                  aria-label={`${defaultSeg.name} (derived)`}
                  className="flex h-10 items-center rounded-md border border-input bg-muted/50 px-3 text-sm text-muted-foreground"
                >
                  {Math.max(0, remainder)}
                  <span className="ml-1.5 text-xs">(auto)</span>
                </div>
              </div>
            )}
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
          <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
            {additional.map((s) => (
              <div key={s.name}>
                <label className={labelCls}>{s.name}</label>
                <ValidatedInput
                  type="number" min={0} max={100000} disabled={disabled}
                  aria-label={s.name}
                  value={counts[s.name] ?? ""}
                  onChange={(e) => setCount(s.name, Number(e.target.value))}
                />
                {rateBox(s)}
              </div>
            ))}
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
