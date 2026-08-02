"use client";

import { ValidatedInput } from "@/components/ui/validated-input";
import { useSiteSettings } from "@/lib/hooks";
import { segmentEffectiveRate, GuestSegmentMeta } from "@/lib/quoteTotals";
import { groupSegments } from "@/components/GuestCountField";

/**
 * Per-head rate by guest type, for the Menu & Pricing card (REL-428).
 *
 * These used to live in the Guests card, which is filled in BEFORE the menu is
 * priced — so every rate there was a number that couldn't be known yet, and the
 * Price/head auto-fill wrote "0.00" the moment a template loaded, which read as
 * "your guests are priced at nothing". Rates belong next to the Price/head they are
 * derived from, and only once that price exists.
 *
 * Each row is one segment: the org default is the read-only base rate; every other
 * segment shows its multiplier default as a placeholder and accepts a flat override.
 * Renders nothing at all until there is a real price to derive from — an unpriced
 * booking simply has no rates to show, which is the honest state.
 */
export default function SegmentRatesField({
  segmentPrices,
  onChange,
  pricePerHead,
  currencySymbol = "$",
  disabled = false,
}: {
  segmentPrices: Record<string, string>;
  onChange: (patch: { segment_prices: Record<string, string> }) => void;
  pricePerHead?: string;
  currencySymbol?: string;
  disabled?: boolean;
}) {
  const { data: settings } = useSiteSettings();
  const segments = (settings?.guest_segments ?? []) as GuestSegmentMeta[];
  const prices = segmentPrices || {};
  const { defaultSeg, explicitInCount, additional } = groupSegments(segments);

  // Zero is "not priced yet", not a price: loading a menu template auto-fills
  // Price/head with the dishes' suggested price, which is "0.00" when those dishes
  // carry no selling price. A comped booking reads as unpriced here too — the right
  // trade, since claiming a $0.00 rate is exactly the failure this avoids.
  if (!(Number(pricePerHead) > 0)) return null;

  // Only segments that can carry a rate. If the org has no split and no extra
  // covers, there is nothing to break down — the Price/head field says it all.
  const overridable = [...explicitInCount, ...additional];
  if (!defaultSeg && overridable.length === 0) return null;

  const setPrice = (name: string, raw: string) =>
    onChange({ segment_prices: { ...prices, [name]: raw } });

  const rowCls = "flex items-center justify-between gap-3";
  const nameCls = "text-sm text-foreground";

  return (
    <div className="mt-3 rounded-lg border border-border bg-muted/30 px-4 py-3">
      <p className="mb-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">
        Price per head by guest type
      </p>
      <div className="space-y-2">
        {defaultSeg && (
          <div className={rowCls}>
            <span className={nameCls}>{defaultSeg.name}</span>
            <span
              aria-label={`${defaultSeg.name} price per head`}
              className="flex h-8 min-w-[7rem] items-center justify-end rounded-md border border-input bg-muted/50 px-3 text-sm text-muted-foreground"
            >
              {currencySymbol}
              {segmentEffectiveRate(pricePerHead, defaultSeg.price_multiplier).toFixed(2)}
              <span className="ml-1.5 text-xs">(auto)</span>
            </span>
          </div>
        )}
        {overridable.map((s) => (
          <div key={s.name} className={rowCls}>
            <span className={nameCls}>
              {s.name}
              {!s.counts_toward_total && (
                <span className="ml-1.5 text-xs text-muted-foreground">(extra cover)</span>
              )}
            </span>
            <div className="flex items-center gap-1.5">
              <span className="text-xs text-muted-foreground">{currencySymbol}</span>
              <ValidatedInput
                type="number" step="0.01" min={0} disabled={disabled}
                aria-label={`${s.name} price per head`}
                placeholder={segmentEffectiveRate(pricePerHead, s.price_multiplier).toFixed(2)}
                value={prices[s.name] ?? ""}
                onChange={(e) => setPrice(s.name, e.target.value)}
                className="h-8 w-24 text-right"
              />
            </div>
          </div>
        ))}
      </div>
      <p className="mt-2 text-xs text-muted-foreground">
        Blank uses the guest type&apos;s multiplier of the price per head above. Type a
        number to charge that guest type a flat rate instead.
      </p>
    </div>
  );
}
