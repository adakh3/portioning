"use client";

import { useAddOnProducts } from "@/lib/hooks";
import { AddOnProduct, AddOnVariant } from "@/lib/api";
import { LineItemInput, lineItemTotal } from "@/lib/quoteTotals";
import { formatCurrency } from "@/lib/utils";

const CATEGORIES: [string, string][] = [
  ["food", "Food"], ["beverage", "Beverage"], ["rental", "Rental"],
  ["labor", "Labour"], ["fee", "Fee"], ["discount", "Discount"],
];
const UNITS: [string, string][] = [
  ["each", "Each"], ["per_guest", "Per guest"], ["per_hour", "Per hour"], ["flat", "Flat"],
];
const cellInput = "h-8 w-full rounded border border-input bg-transparent px-2 text-sm";

/** Unified add-on editor used by quotes and events: featured catalog products as
 * checkboxes (tick → priced variants with qty), plus an "other items" table for
 * non-featured catalog products and ad-hoc custom rows. Emits LineItemInput[]. */
export default function AddOnItemsEditor({
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
  const { data: products = [] } = useAddOnProducts();
  const featured = products.filter((p) => p.is_featured && p.variants.length);
  const nonFeatured = products.filter((p) => !p.is_featured && p.variants.length);
  const featuredVariantIds = new Set(featured.flatMap((p) => p.variants.map((v) => v.id)));

  const update = (i: number, field: keyof LineItemInput, value: unknown) =>
    onChange(items.map((it, idx) => (idx === i ? { ...it, [field]: value } : it)));
  const removeAt = (i: number) => onChange(items.filter((_, idx) => idx !== i));
  const add = (item: LineItemInput) => onChange([...items, item]);

  const variantLine = (p: AddOnProduct, v: AddOnVariant): LineItemInput => ({
    variant: v.id,
    category: p.category,
    description: v.name ? `${p.name} — ${v.name}` : p.name,
    quantity: "1",
    unit: p.default_unit,
    unit_price: v.unit_price,
    is_taxable: p.is_taxable,
  });
  const indexOfVariant = (id: number) => items.findIndex((it) => it.variant === id);

  const otherRows = items
    .map((it, i) => ({ it, i }))
    .filter(({ it }) => !it.variant || !featuredVariantIds.has(it.variant));

  const fmt = (n: number) => formatCurrency(n, currencySymbol);

  return (
    <div className="space-y-5">
      {featured.length > 0 && (
        <div className="space-y-3">
          {featured.map((p) => (
            <div key={p.id}>
              <p className="text-xs font-medium text-muted-foreground mb-1">{p.name}</p>
              <div className="space-y-1.5">
                {p.variants.map((v) => {
                  const i = indexOfVariant(v.id);
                  const checked = i >= 0;
                  return (
                    <div key={v.id} className="flex items-center gap-2 flex-wrap">
                      <label className="flex items-center gap-2 cursor-pointer min-w-[180px]">
                        <input type="checkbox" checked={checked}
                          onChange={() => (checked ? removeAt(i) : add(variantLine(p, v)))}
                          className="rounded border-input" />
                        <span className="text-sm">{v.name || p.name}</span>
                      </label>
                      {checked && (
                        <>
                          <input type="number" min={1} step="1" value={items[i].quantity}
                            onChange={(e) => update(i, "quantity", e.target.value)}
                            className="w-16 h-8 rounded border border-input px-2 text-sm text-right" />
                          <span className="text-xs text-muted-foreground">×</span>
                          <span className="text-xs text-muted-foreground">{currencySymbol}</span>
                          <input type="number" min={0} step="0.01" value={items[i].unit_price}
                            onChange={(e) => update(i, "unit_price", e.target.value)}
                            className="w-24 h-8 rounded border border-input px-2 text-sm text-right" />
                          <span className="ml-auto text-sm font-medium">{fmt(lineItemTotal(items[i], guestCount))}</span>
                        </>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          ))}
        </div>
      )}

      <div>
        <div className="flex items-center gap-3 mb-2 flex-wrap">
          <p className="text-xs font-medium text-muted-foreground">Other items</p>
          {nonFeatured.length > 0 && (
            <select className="h-8 rounded border border-input bg-transparent px-2 text-sm" value=""
              onChange={(e) => {
                const vid = Number(e.target.value);
                if (!vid) return;
                for (const p of nonFeatured) {
                  const v = p.variants.find((x) => x.id === vid);
                  if (v) { add(variantLine(p, v)); break; }
                }
              }}>
              <option value="">+ Add from catalog…</option>
              {nonFeatured.map((p) => (
                <optgroup key={p.id} label={p.name}>
                  {p.variants.map((v) => <option key={v.id} value={v.id}>{v.name || p.name}</option>)}
                </optgroup>
              ))}
            </select>
          )}
          <button type="button"
            onClick={() => add({ variant: null, category: "fee", description: "", quantity: "1", unit: "each", unit_price: "", is_taxable: true })}
            className="text-xs text-primary hover:underline">+ Custom item</button>
        </div>

        {otherRows.length > 0 && (
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
              {otherRows.map(({ it, i }) => (
                <tr key={i} className="border-b border-border/50 align-middle">
                  <td className="py-1 pr-2 min-w-[110px]">
                    <select className={cellInput} value={it.category} onChange={(e) => update(i, "category", e.target.value)}>
                      {CATEGORIES.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
                    </select>
                  </td>
                  <td className="py-1 pr-2 min-w-[160px]">
                    <input className={cellInput} value={it.description} placeholder="Description" onChange={(e) => update(i, "description", e.target.value)} />
                  </td>
                  <td className="py-1 pr-2 w-20">
                    <input type="number" step="0.01" min={0} className={`${cellInput} text-right`} value={it.quantity} onChange={(e) => update(i, "quantity", e.target.value)} />
                  </td>
                  <td className="py-1 pr-2 min-w-[110px]">
                    <select className={cellInput} value={it.unit} onChange={(e) => update(i, "unit", e.target.value)}>
                      {UNITS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
                    </select>
                  </td>
                  <td className="py-1 pr-2 w-24">
                    <input type="number" step="0.01" min={0} className={`${cellInput} text-right`} value={it.unit_price} placeholder="0.00" onChange={(e) => update(i, "unit_price", e.target.value)} />
                  </td>
                  <td className="py-1 text-center">
                    <input type="checkbox" checked={it.is_taxable} onChange={(e) => update(i, "is_taxable", e.target.checked)} className="rounded border-input" />
                  </td>
                  <td className="py-1 text-right font-medium whitespace-nowrap">{fmt(lineItemTotal(it, guestCount))}</td>
                  <td className="py-1 text-right">
                    <button type="button" onClick={() => removeAt(i)} className="text-destructive hover:text-destructive/80 text-xs">Remove</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
