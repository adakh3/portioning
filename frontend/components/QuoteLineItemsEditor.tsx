"use client";

import { LineItemInput, lineItemTotal } from "@/lib/quoteTotals";
import { formatCurrency } from "@/lib/utils";

const CATEGORIES: [string, string][] = [
  ["food", "Food"], ["beverage", "Beverage"], ["rental", "Rental"],
  ["labor", "Labour"], ["fee", "Fee"], ["discount", "Discount"],
];
const UNITS: [string, string][] = [
  ["each", "Each"], ["per_guest", "Per Guest"], ["per_hour", "Per Hour"], ["flat", "Flat Rate"],
];

const cellInput = "h-8 w-full rounded border border-input bg-transparent px-2 text-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring";

/** Inline-editable line items (add / edit any cell / remove). Used in both the
 * create and edit quote flows; the parent holds the array and saves it with the
 * rest of the quote. */
export default function QuoteLineItemsEditor({
  items,
  onChange,
  guestCount,
  currencySymbol,
}: {
  items: LineItemInput[];
  onChange: (items: LineItemInput[]) => void;
  guestCount: number;
  currencySymbol: string;
}) {
  const update = (i: number, field: keyof LineItemInput, value: unknown) =>
    onChange(items.map((it, idx) => (idx === i ? { ...it, [field]: value } : it)));
  const remove = (i: number) => onChange(items.filter((_, idx) => idx !== i));
  const add = () =>
    onChange([
      ...items,
      { category: "food", description: "", quantity: "1", unit: "each", unit_price: "", is_taxable: true, sort_order: items.length },
    ]);

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-border text-left text-muted-foreground">
            <th className="pb-2 font-medium">Category</th>
            <th className="pb-2 font-medium">Description</th>
            <th className="pb-2 font-medium">Qty</th>
            <th className="pb-2 font-medium">Unit</th>
            <th className="pb-2 font-medium">Price</th>
            <th className="pb-2 font-medium text-center">Tax</th>
            <th className="pb-2 font-medium text-right">Total</th>
            <th className="pb-2"></th>
          </tr>
        </thead>
        <tbody>
          {items.length === 0 && (
            <tr>
              <td colSpan={8} className="py-3 text-muted-foreground text-sm">No additional items.</td>
            </tr>
          )}
          {items.map((item, i) => (
            <tr key={i} className="border-b border-border/50 align-middle">
              <td className="py-1 pr-2 min-w-[110px]">
                <select className={cellInput} value={item.category} onChange={(e) => update(i, "category", e.target.value)}>
                  {CATEGORIES.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
                </select>
              </td>
              <td className="py-1 pr-2 min-w-[160px]">
                <input className={cellInput} value={item.description} placeholder="Description" onChange={(e) => update(i, "description", e.target.value)} />
              </td>
              <td className="py-1 pr-2 w-20">
                <input type="number" step="0.01" min={0} className={`${cellInput} text-right`} value={item.quantity} onChange={(e) => update(i, "quantity", e.target.value)} />
              </td>
              <td className="py-1 pr-2 min-w-[110px]">
                <select className={cellInput} value={item.unit} onChange={(e) => update(i, "unit", e.target.value)}>
                  {UNITS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
                </select>
              </td>
              <td className="py-1 pr-2 w-24">
                <input type="number" step="0.01" min={0} className={`${cellInput} text-right`} value={item.unit_price} placeholder="0.00" onChange={(e) => update(i, "unit_price", e.target.value)} />
              </td>
              <td className="py-1 text-center">
                <input type="checkbox" checked={item.is_taxable} onChange={(e) => update(i, "is_taxable", e.target.checked)} className="rounded border-input" />
              </td>
              <td className="py-1 text-right font-medium text-foreground whitespace-nowrap">
                {formatCurrency(lineItemTotal(item, guestCount), currencySymbol)}
              </td>
              <td className="py-1 text-right">
                <button type="button" onClick={() => remove(i)} className="text-destructive hover:text-destructive/80 text-xs">Remove</button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <button type="button" onClick={add} className="mt-3 text-sm font-medium text-primary hover:text-primary/80">
        + Add line item
      </button>
    </div>
  );
}
