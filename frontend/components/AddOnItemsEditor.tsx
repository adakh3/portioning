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
const CATEGORY_LABELS: Record<string, string> = {
  food: "Food", beverage: "Beverages", rental: "Arrangements & rentals",
  labor: "Labour", fee: "Fees", discount: "Discounts",
};
const CATEGORY_ORDER = ["beverage", "rental", "food", "labor", "fee", "discount"];

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
  // Featured products surface as checkboxes — including those with no priced
  // variant yet (price entered inline), so nothing the user adds in admin is
  // silently hidden. Non-featured products still need a variant to be pickable.
  const featured = products.filter((p) => p.is_featured);
  const nonFeatured = products.filter((p) => !p.is_featured && p.variants.length);
  const featuredVariantIds = new Set(featured.flatMap((p) => p.variants.map((v) => v.id)));
  const bareProductNames = new Set(featured.filter((p) => !p.variants.length).map((p) => p.name));

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
  });
  const indexOfVariant = (id: number) => items.findIndex((it) => it.variant === id);

  // Featured product with no priced variant: pick by product, price entered inline.
  const productLine = (p: AddOnProduct): LineItemInput => ({
    variant: null,
    category: p.category,
    description: p.name,
    quantity: "1",
    unit: p.default_unit,
    unit_price: p.unit_price ?? "",
  });
  const indexOfProduct = (p: AddOnProduct) =>
    items.findIndex((it) => !it.variant && it.description === p.name);

  const otherRows = items
    .map((it, i) => ({ it, i }))
    .filter(({ it }) =>
      it.variant ? !featuredVariantIds.has(it.variant) : !bareProductNames.has(it.description),
    );

  const fmt = (n: number) => formatCurrency(n, currencySymbol);

  const grouped: Record<string, AddOnProduct[]> = {};
  featured.forEach((p) => { (grouped[p.category] ||= []).push(p); });
  const categories = [
    ...CATEGORY_ORDER.filter((c) => grouped[c]?.length),
    ...Object.keys(grouped).filter((c) => !CATEGORY_ORDER.includes(c)),
  ];

  function variantRow(p: AddOnProduct, v: AddOnVariant, label: string) {
    const i = indexOfVariant(v.id);
    const checked = i >= 0;
    return (
      <div key={v.id}>
        <label className="flex items-center gap-2 cursor-pointer">
          <input type="checkbox" checked={checked}
            onChange={() => (checked ? removeAt(i) : add(variantLine(p, v)))}
            className="rounded border-input" />
          <span className="text-sm">{label}</span>
          {!checked && Number(v.unit_price) > 0 && (
            <span className="text-xs text-muted-foreground">{fmt(Number(v.unit_price))}</span>
          )}
        </label>
        {checked && (
          <div className="flex items-center gap-2 mt-1 ml-6">
            <input type="number" min={1} step="1" value={items[i].quantity}
              onChange={(e) => update(i, "quantity", e.target.value)}
              className="w-14 h-7 rounded border border-input px-2 text-sm text-right" />
            <span className="text-xs text-muted-foreground">× {currencySymbol}</span>
            <input type="number" min={0} step="0.01" value={items[i].unit_price}
              onChange={(e) => update(i, "unit_price", e.target.value)}
              className="w-20 h-7 rounded border border-input px-2 text-sm text-right" />
            <span className="ml-auto text-sm font-medium">{fmt(lineItemTotal(items[i], guestCount))}</span>
          </div>
        )}
      </div>
    );
  }

  function productRow(p: AddOnProduct) {
    const i = indexOfProduct(p);
    const checked = i >= 0;
    return (
      <div key={`p-${p.id}`}>
        <label className="flex items-center gap-2 cursor-pointer">
          <input type="checkbox" checked={checked}
            onChange={() => (checked ? removeAt(i) : add(productLine(p)))}
            className="rounded border-input" />
          <span className="text-sm">{p.name}</span>
        </label>
        {checked && (
          <div className="flex items-center gap-2 mt-1 ml-6">
            <input type="number" min={1} step="1" value={items[i].quantity}
              onChange={(e) => update(i, "quantity", e.target.value)}
              className="w-14 h-7 rounded border border-input px-2 text-sm text-right" />
            <span className="text-xs text-muted-foreground">× {currencySymbol}</span>
            <input type="number" min={0} step="0.01" value={items[i].unit_price} placeholder="0.00"
              onChange={(e) => update(i, "unit_price", e.target.value)}
              className="w-20 h-7 rounded border border-input px-2 text-sm text-right" />
            <span className="ml-auto text-sm font-medium">{fmt(lineItemTotal(items[i], guestCount))}</span>
          </div>
        )}
      </div>
    );
  }

  return (
    <div className="space-y-5">
      {featured.length > 0 && (
        <div className="space-y-4">
          {categories.map((cat) => (
            <div key={cat}>
              <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-2">
                {CATEGORY_LABELS[cat] || cat}
              </p>
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-x-8 gap-y-2">
                {grouped[cat].map((p) =>
                  p.variants.length > 1 ? (
                    <div key={p.id}>
                      <p className="text-xs font-medium text-foreground mb-0.5">{p.name}</p>
                      <div className="space-y-1 ml-1">
                        {p.variants.map((v) => variantRow(p, v, v.name || p.name))}
                      </div>
                    </div>
                  ) : p.variants.length === 1 ? (
                    variantRow(p, p.variants[0], p.name)
                  ) : (
                    productRow(p)
                  )
                )}
              </div>
            </div>
          ))}
        </div>
      )}

      <div>
        <div className="flex items-center gap-3 mb-2 flex-wrap">
          <p className="text-xs font-medium text-muted-foreground">Not listed above?</p>
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
            onClick={() => add({ variant: null, category: "fee", description: "", quantity: "1", unit: "each", unit_price: "" })}
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
