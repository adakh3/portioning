"use client";

import type { ReactNode } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { formatCurrency } from "@/lib/utils";

/** A money value as the card receives it.
 *
 * Strings are the point: the pricing engine answers in decimal strings, and
 * parsing `"9850.00"` into a float only to format it back is the drift this card
 * stopped taking part in. They arrive as text and leave as text. */
export type Money = string | number;

/** Zero-ness for deciding whether a ROW IS SHOWN — never for arithmetic.
 * `"0.00" !== 0` in JS, so comparing the raw prop would print an empty add-ons
 * line on every booking that has no add-ons. */
const isZero = (v: Money): boolean => (Number(v) || 0) === 0;

export interface TotalsMealRow {
  label: ReactNode;
  total: Money;
}

export interface TotalsFoodRow {
  name: string;
  count: number;
  rate: Money;
  amount: Money;
}

/**
 * The shared, detailed booking-totals breakdown — used by BOTH the quote and
 * event pages so they look and add up identically. Renders Food → (meals) →
 * Add-on items → Subtotal → Tax → Total.
 *
 * It computes nothing. Every figure is handed to it already priced — since
 * REL-465 by the backend engine, via `POST /api/pricing/preview` — and its whole
 * job is to lay them out.
 *
 * - `taxRateField` renders an editable tax-rate input above the box (quotes).
 * - `taxControl` replaces the tax-row label (e.g. the event's is-taxable
 *   checkbox); when omitted the label is `{taxLabel} ({taxPercent}%)`.
 * - `taxApplied=false` shows "— not applied" and a dash instead of an amount.
 * - `isStale` dims the box while fresher numbers are on their way. The figures
 *   STAY on screen: a totals card that blanks mid-keystroke reads as "your
 *   booking is worth nothing". `staleHint` says why, when there's a reason worth
 *   giving (a failed refresh).
 */
export default function BookingTotalsCard({
  title,
  currencySymbol,
  foodTotal,
  foodLabel,
  foodRows = null,
  meals = [],
  addOnsTotal,
  subtotal,
  serviceCharge = 0,
  serviceChargePct = "0",
  serviceChargeControl,
  taxAmount,
  gratuity = 0,
  gratuityPct = "0",
  gratuityControl,
  total,
  taxLabel,
  taxPercent,
  taxApplied = true,
  taxRateField,
  taxControl,
  isStale = false,
  staleHint,
}: {
  title: string;
  currencySymbol: string;
  foodTotal: Money;
  foodLabel: ReactNode;
  foodRows?: TotalsFoodRow[] | null;
  meals?: TotalsMealRow[];
  addOnsTotal: Money;
  subtotal: Money;
  serviceCharge?: Money;
  serviceChargePct?: string;
  serviceChargeControl?: ReactNode;
  taxAmount: Money;
  gratuity?: Money;
  gratuityPct?: string;
  gratuityControl?: ReactNode;
  total: Money;
  taxLabel: string;
  taxPercent: string;
  taxApplied?: boolean;
  taxRateField?: ReactNode;
  taxControl?: ReactNode;
  isStale?: boolean;
  staleHint?: string;
}) {
  const fmt = (n: Money) => formatCurrency(n, currencySymbol);

  return (
    <Card>
      <CardContent className="p-6">
        <div className="flex items-baseline justify-between mb-3 gap-3">
          <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide">{title}</h2>
          {staleHint && (
            <span role="status" className="text-xs text-muted-foreground">{staleHint}</span>
          )}
        </div>
        {taxRateField && <div className="ml-auto max-w-sm mb-4">{taxRateField}</div>}
        <div
          data-stale={isStale ? "true" : undefined}
          aria-busy={isStale || undefined}
          className={`border border-border rounded-lg divide-y divide-border transition-opacity duration-200 ${isStale ? "opacity-60 animate-pulse" : ""}`}
        >
          {foodRows && foodRows.length > 0 ? (
            foodRows.map((r, i) => (
              <div key={`seg-${i}`} className="flex justify-between px-4 py-2 text-sm">
                <span className="text-muted-foreground">{r.name} — {r.count} × {fmt(r.rate)}</span>
                <span className="font-medium text-foreground">{fmt(r.amount)}</span>
              </div>
            ))
          ) : (
            Number(foodTotal) > 0 && (
              <div className="flex justify-between px-4 py-2 text-sm">
                <span className="text-muted-foreground">{foodLabel}</span>
                <span className="font-medium text-foreground">{fmt(foodTotal)}</span>
              </div>
            )
          )}
          {meals.map((m, i) => (
            <div key={i} className="flex justify-between px-4 py-2 text-sm">
              <span className="text-muted-foreground">{m.label}</span>
              <span className="font-medium text-foreground">{fmt(m.total)}</span>
            </div>
          ))}
          {!isZero(addOnsTotal) && (
            <div className="flex justify-between px-4 py-2 text-sm">
              <span className="text-muted-foreground">Add-on items</span>
              <span className="font-medium text-foreground">{fmt(addOnsTotal)}</span>
            </div>
          )}
          <div className="flex justify-between px-4 py-2 text-sm font-medium">
            <span className="text-foreground">Subtotal</span>
            <span className="text-foreground">{fmt(subtotal)}</span>
          </div>
          {(!isZero(serviceCharge) || serviceChargeControl) && (
            <div className="flex justify-between items-center px-4 py-2 text-sm">
              <span className="text-muted-foreground flex items-center gap-2">
                {serviceChargeControl ?? <span>Service charge ({serviceChargePct}%)</span>}
              </span>
              <span className="font-medium text-foreground">{fmt(serviceCharge)}</span>
            </div>
          )}
          <div className="flex justify-between items-center px-4 py-2 text-sm">
            <span className="text-muted-foreground flex items-center gap-2">
              {taxControl ?? (
                <span>{taxLabel} ({taxPercent}%){!taxApplied && " — not applied"}</span>
              )}
            </span>
            <span className="font-medium text-foreground">{taxApplied ? fmt(taxAmount) : "—"}</span>
          </div>
          {(!isZero(gratuity) || gratuityControl) && (
            <div className="flex justify-between items-center px-4 py-2 text-sm">
              <span className="text-muted-foreground flex items-center gap-2">
                {gratuityControl ?? <span>Gratuity ({gratuityPct}%)</span>}
              </span>
              <span className="font-medium text-foreground">{fmt(gratuity)}</span>
            </div>
          )}
          <div className="flex justify-between px-4 py-3 text-base font-bold bg-muted/30">
            <span className="text-foreground">Total</span>
            <span className="text-foreground">{fmt(total)}</span>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
