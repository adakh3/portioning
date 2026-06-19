"use client";

import { Card, CardContent } from "@/components/ui/card";
import { formatCurrency } from "@/lib/utils";

/** Unified quote total — food/menu (price/head × guests) + additional line
 * items, then tax and grand total. Used in the create and edit flows. */
export default function QuoteTotalsCard({
  foodTotal,
  subtotal,
  taxAmount,
  total,
  pricePerHead,
  guestCount,
  taxPercent,
  currencySymbol,
}: {
  foodTotal: number;
  subtotal: number;
  taxAmount: number;
  total: number;
  pricePerHead: string | number;
  guestCount: string | number;
  taxPercent: string;
  currencySymbol: string;
}) {
  const itemsTotal = Math.round((subtotal - foodTotal) * 100) / 100;
  const fmt = (n: number | string) => formatCurrency(n, currencySymbol);

  return (
    <Card>
      <CardContent className="p-6">
        <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide mb-3">Quote Total</h2>
        <div className="ml-auto max-w-sm space-y-1.5 text-sm">
          {foodTotal > 0 && (
            <div className="flex justify-between">
              <span className="text-muted-foreground">Food / Menu ({fmt(pricePerHead || 0)}/head × {guestCount || 0} guests)</span>
              <span className="font-medium">{fmt(foodTotal)}</span>
            </div>
          )}
          {itemsTotal !== 0 && (
            <div className="flex justify-between">
              <span className="text-muted-foreground">Additional items</span>
              <span className="font-medium">{fmt(itemsTotal)}</span>
            </div>
          )}
          <div className="flex justify-between border-t border-border pt-1.5">
            <span className="text-muted-foreground">Subtotal</span>
            <span className="font-medium">{fmt(subtotal)}</span>
          </div>
          <div className="flex justify-between">
            <span className="text-muted-foreground">VAT ({taxPercent}%)</span>
            <span>{fmt(taxAmount)}</span>
          </div>
          <div className="flex justify-between border-t border-border pt-1.5">
            <span className="font-semibold text-foreground">Total</span>
            <span className="font-bold text-lg text-foreground">{fmt(total)}</span>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
