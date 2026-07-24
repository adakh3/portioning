"use client";

import type { ReactNode } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { formatCurrency } from "@/lib/utils";

export interface TotalsMealRow {
  label: ReactNode;
  total: number;
}

/**
 * The shared, detailed booking-totals breakdown — used by BOTH the quote and
 * event pages so they look and add up identically. Renders Food → (meals) →
 * Add-on items → Subtotal → Tax → Total. The numbers come from the shared
 * engine (`lib/quoteTotals.ts: computeBookingTotals`).
 *
 * - `taxRateField` renders an editable tax-rate input above the box (quotes).
 * - `taxControl` replaces the tax-row label (e.g. the event's is-taxable
 *   checkbox); when omitted the label is `{taxLabel} ({taxPercent}%)`.
 * - `taxApplied=false` shows "— not applied" and a dash instead of an amount.
 */
export default function BookingTotalsCard({
  title,
  currencySymbol,
  foodTotal,
  foodLabel,
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
}: {
  title: string;
  currencySymbol: string;
  foodTotal: number;
  foodLabel: ReactNode;
  meals?: TotalsMealRow[];
  addOnsTotal: number;
  subtotal: number;
  serviceCharge?: number;
  serviceChargePct?: string;
  serviceChargeControl?: ReactNode;
  taxAmount: number;
  gratuity?: number;
  gratuityPct?: string;
  gratuityControl?: ReactNode;
  total: number;
  taxLabel: string;
  taxPercent: string;
  taxApplied?: boolean;
  taxRateField?: ReactNode;
  taxControl?: ReactNode;
}) {
  const fmt = (n: number | string) => formatCurrency(n, currencySymbol);

  return (
    <Card>
      <CardContent className="p-6">
        <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide mb-3">{title}</h2>
        {taxRateField && <div className="ml-auto max-w-sm mb-4">{taxRateField}</div>}
        <div className="border border-border rounded-lg divide-y divide-border">
          {foodTotal > 0 && (
            <div className="flex justify-between px-4 py-2 text-sm">
              <span className="text-muted-foreground">{foodLabel}</span>
              <span className="font-medium text-foreground">{fmt(foodTotal)}</span>
            </div>
          )}
          {meals.map((m, i) => (
            <div key={i} className="flex justify-between px-4 py-2 text-sm">
              <span className="text-muted-foreground">{m.label}</span>
              <span className="font-medium text-foreground">{fmt(m.total)}</span>
            </div>
          ))}
          {addOnsTotal !== 0 && (
            <div className="flex justify-between px-4 py-2 text-sm">
              <span className="text-muted-foreground">Add-on items</span>
              <span className="font-medium text-foreground">{fmt(addOnsTotal)}</span>
            </div>
          )}
          <div className="flex justify-between px-4 py-2 text-sm font-medium">
            <span className="text-foreground">Subtotal</span>
            <span className="text-foreground">{fmt(subtotal)}</span>
          </div>
          {(serviceCharge !== 0 || serviceChargeControl) && (
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
          {(gratuity !== 0 || gratuityControl) && (
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
