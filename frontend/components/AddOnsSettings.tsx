"use client";

import { useMemo, useState } from "react";
import { api, AddOnProduct, AddOnVariant } from "@/lib/api";
import { useManagedAddOnProducts, useSiteSettings, revalidate } from "@/lib/hooks";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

// Mirror backend LineItemCategory / LineItemUnit (bookings/models/quotes.py).
const CATEGORIES = [
  { value: "food", label: "Food" },
  { value: "beverage", label: "Beverage" },
  { value: "rental", label: "Rental" },
  { value: "labor", label: "Labour" },
  { value: "fee", label: "Fee" },
  { value: "discount", label: "Discount" },
];
const UNITS = [
  { value: "each", label: "Each" },
  { value: "per_guest", label: "Per Guest" },
  { value: "per_hour", label: "Per Hour" },
  { value: "flat", label: "Flat Rate" },
];
const labelOf = (list: { value: string; label: string }[], v: string) =>
  list.find((x) => x.value === v)?.label ?? v;

// Shared column widths so the header lines up with each row.
const COL = {
  name: "flex-1 min-w-[140px]",
  type: "hidden sm:block w-24 shrink-0",
  unit: "hidden sm:block w-24 shrink-0",
  price: "w-24 shrink-0 text-right",
  variants: "hidden md:block w-20 shrink-0 text-right",
  featured: "w-20 shrink-0 text-center",
  actions: "w-24 shrink-0 text-right",
};

type SortKey = "name" | "type" | "unit" | "price" | "variants" | "featured";
type SortDir = "asc" | "desc";

const sortValue = (p: AddOnProduct, key: SortKey): string | number => {
  switch (key) {
    case "name": return p.name.toLowerCase();
    case "type": return labelOf(CATEGORIES, p.category).toLowerCase();
    case "unit": return labelOf(UNITS, p.default_unit).toLowerCase();
    case "price": return parseFloat(p.unit_price || "0");
    case "variants": return p.variants.length;
    case "featured": return p.is_featured ? 1 : 0;
  }
};

/** The writable subset of a variant the manage endpoint round-trips. New rows
 * (no id) are created; omitted rows are deleted. */
type WritableVariant = {
  id?: number;
  name: string;
  unit_price: string | null;
  is_active: boolean;
  sort_order: number;
};

const writable = (v: AddOnVariant): WritableVariant => ({
  id: v.id,
  name: v.name,
  unit_price: v.unit_price,
  is_active: v.is_active,
  sort_order: v.sort_order,
});

const selectClass = "h-8 rounded border border-input bg-transparent px-2 text-sm";

/** Manage the add-on catalog (Settings, owner/admin): products and their priced
 * variants. Compact list by default; a row expands into a full editor only while
 * it's being edited. Featured products surface as quick checkboxes on
 * quotes/events, so every save also refreshes those pickers. */
export default function AddOnsSettings() {
  const { data: products = [], mutate, isLoading } = useManagedAddOnProducts();
  const { data: settings } = useSiteSettings();
  const symbol = settings?.currency_symbol ?? "";
  const [newName, setNewName] = useState("");
  const [editingId, setEditingId] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  // null sortKey = keep the server's order (sort_order, then name).
  const [sortKey, setSortKey] = useState<SortKey | null>(null);
  const [sortDir, setSortDir] = useState<SortDir>("asc");

  const toggleSort = (key: SortKey) => {
    if (sortKey === key) setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    else { setSortKey(key); setSortDir("asc"); }
  };

  const sorted = useMemo(() => {
    if (!sortKey) return products;
    const arr = [...products].sort((a, b) => {
      const av = sortValue(a, sortKey), bv = sortValue(b, sortKey);
      const cmp = av < bv ? -1 : av > bv ? 1 : 0;
      return sortDir === "asc" ? cmp : -cmp;
    });
    return arr;
  }, [products, sortKey, sortDir]);

  async function run(fn: () => Promise<unknown>) {
    setBusy(true);
    setError("");
    try {
      await fn();
      await mutate();
      revalidate("addon-products"); // refresh quote/event add-on pickers
    } catch (e) {
      setError(e instanceof Error ? e.message : "Something went wrong");
    } finally {
      setBusy(false);
    }
  }

  const patch = (p: AddOnProduct, data: Partial<AddOnProduct>) =>
    run(() => api.updateAddOnProduct(p.id, data));
  const remove = (p: AddOnProduct) => {
    if (editingId === p.id) setEditingId(null);
    return run(() => api.deleteAddOnProduct(p.id));
  };

  const add = async () => {
    const name = newName.trim();
    if (!name) return;
    setNewName("");
    const created = await api.createAddOnProduct({
      name, category: "rental", default_unit: "each", unit_price: "0",
    }).catch((e) => { setError(e instanceof Error ? e.message : "Something went wrong"); return null; });
    await mutate();
    revalidate("addon-products");
    if (created?.id) setEditingId(created.id); // drop straight into editing the new row
  };

  // Variant edits send the WHOLE variants array; the backend upserts by id and
  // deletes any omitted row.
  const patchVariants = (p: AddOnProduct, variants: WritableVariant[]) =>
    patch(p, { variants: variants as unknown as AddOnVariant[] });
  const addVariant = (p: AddOnProduct) =>
    patchVariants(p, [
      ...p.variants.map(writable),
      { name: "", unit_price: null, is_active: true, sort_order: p.variants.length },
    ]);
  const patchVariant = (p: AddOnProduct, v: AddOnVariant, data: Partial<WritableVariant>) =>
    patchVariants(p, p.variants.map((x) => (x.id === v.id ? { ...writable(x), ...data } : writable(x))));
  const removeVariant = (p: AddOnProduct, v: AddOnVariant) =>
    patchVariants(p, p.variants.filter((x) => x.id !== v.id).map(writable));

  return (
    <Card>
      <CardHeader>
        <CardTitle>Add-ons</CardTitle>
      </CardHeader>
      <CardContent>
        <p className="text-xs text-muted-foreground mb-4">
          Priced products &amp; services you can add to quotes and events (e.g. Mocktails, Chair
          rental). Give a product one or more variants; a variant with no price inherits the
          product&rsquo;s base price. &ldquo;Featured&rdquo; products show as a quick checkbox when
          adding items to a quote or event.
        </p>
        {error && <p className="text-destructive text-sm mb-3" role="alert">{error}</p>}
        {isLoading ? (
          <p className="text-muted-foreground text-sm">Loading…</p>
        ) : (
          <div className="border border-border rounded-md divide-y divide-border">
            {products.length === 0 ? (
              <p className="text-muted-foreground text-sm px-3 py-4">No add-ons yet.</p>
            ) : (
              <SortHeader sortKey={sortKey} sortDir={sortDir} onSort={toggleSort} />
            )}
            {sorted.map((p) =>
              editingId === p.id ? (
                <AddOnEditor
                  key={p.id}
                  p={p}
                  symbol={symbol}
                  busy={busy}
                  onDone={() => setEditingId(null)}
                  patch={patch}
                  remove={remove}
                  addVariant={addVariant}
                  patchVariant={patchVariant}
                  removeVariant={removeVariant}
                />
              ) : (
                <AddOnRow
                  key={p.id}
                  p={p}
                  symbol={symbol}
                  busy={busy}
                  onEdit={() => setEditingId(p.id)}
                  onRemove={() => remove(p)}
                />
              ),
            )}

            <div className="flex items-center gap-2 px-3 py-2">
              <Input
                placeholder="New add-on…"
                value={newName}
                disabled={busy}
                onChange={(e) => setNewName(e.target.value)}
                onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); add(); } }}
                className="h-8 max-w-xs"
              />
              <Button type="button" size="sm" variant="outline" disabled={busy || !newName.trim()} onClick={add}>
                + Add add-on
              </Button>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

/** Clickable, sortable column header aligned to the compact rows. */
function SortHeader({
  sortKey, sortDir, onSort,
}: {
  sortKey: SortKey | null; sortDir: SortDir; onSort: (k: SortKey) => void;
}) {
  const Head = ({ k, label, className }: { k: SortKey; label: string; className: string }) => {
    const active = sortKey === k;
    return (
      <button
        type="button"
        onClick={() => onSort(k)}
        aria-label={`Sort by ${label}`}
        className={`${className} group inline-flex items-center gap-1 cursor-pointer text-xs font-medium uppercase tracking-wide ${active ? "text-foreground" : "text-muted-foreground hover:text-foreground"}`}
      >
        <span className="truncate">{label}</span>
        {/* Persistent affordance: a faint ↕ on every column, a solid ▲/▼ on the sorted one. */}
        <span className={active ? "text-primary" : "opacity-40 group-hover:opacity-70"} aria-hidden="true">
          {active ? (sortDir === "asc" ? "▲" : "▼") : "↕"}
        </span>
      </button>
    );
  };
  return (
    <div className="flex items-center gap-3 px-3 py-2 bg-muted/40">
      <Head k="name" label="Name" className={`${COL.name} justify-start`} />
      <Head k="type" label="Type" className={`${COL.type} justify-start`} />
      <Head k="unit" label="Unit" className={`${COL.unit} justify-start`} />
      <Head k="price" label="Price" className={`${COL.price} justify-end`} />
      <Head k="variants" label="Variants" className={`${COL.variants} justify-end`} />
      <Head k="featured" label="Featured" className={`${COL.featured} justify-center`} />
      <span className={COL.actions} aria-hidden="true" />
    </div>
  );
}

/** One compact, read-only catalog row. Click Edit to expand it into the editor. */
function AddOnRow({
  p, symbol, busy, onEdit, onRemove,
}: {
  p: AddOnProduct; symbol: string; busy: boolean; onEdit: () => void; onRemove: () => void;
}) {
  return (
    <div className="flex items-center gap-3 px-3 py-2 text-sm">
      <button
        type="button"
        onClick={onEdit}
        data-testid="addon-row-name"
        className={`${COL.name} font-medium text-left truncate hover:underline`}
        title="Edit"
      >
        {p.name}
        {!p.is_active && <span className="ml-2 text-xs text-muted-foreground">(hidden)</span>}
      </button>
      <span className={`${COL.type} text-xs text-muted-foreground truncate`}>{labelOf(CATEGORIES, p.category)}</span>
      <span className={`${COL.unit} text-xs text-muted-foreground truncate`}>{labelOf(UNITS, p.default_unit)}</span>
      <span className={`${COL.price} tabular-nums`}>{symbol}{p.unit_price}</span>
      <span className={`${COL.variants} text-xs text-muted-foreground`}>
        {p.variants.length > 0 ? p.variants.length : ""}
      </span>
      <span className={COL.featured}>
        {p.is_featured && (
          <span className="text-xs px-1.5 py-0.5 rounded bg-primary/10 text-primary border border-primary/30">
            Featured
          </span>
        )}
      </span>
      <span className={`${COL.actions} flex items-center justify-end gap-1`}>
        <Button type="button" size="sm" variant="ghost" className="h-7 text-xs" disabled={busy} onClick={onEdit}>
          Edit
        </Button>
        <button
          type="button"
          disabled={busy}
          onClick={onRemove}
          aria-label={`Delete ${p.name}`}
          className="text-destructive hover:text-destructive/80 text-xs px-1"
        >
          ✕
        </button>
      </span>
    </div>
  );
}

/** The expanded, card-style editor for a single add-on (only shown while editing). */
function AddOnEditor({
  p, symbol, busy, onDone, patch, remove, addVariant, patchVariant, removeVariant,
}: {
  p: AddOnProduct;
  symbol: string;
  busy: boolean;
  onDone: () => void;
  patch: (p: AddOnProduct, data: Partial<AddOnProduct>) => void;
  remove: (p: AddOnProduct) => void;
  addVariant: (p: AddOnProduct) => void;
  patchVariant: (p: AddOnProduct, v: AddOnVariant, data: Partial<WritableVariant>) => void;
  removeVariant: (p: AddOnProduct, v: AddOnVariant) => void;
}) {
  return (
    <div className="p-3 space-y-2 bg-muted/40">
      <div className="flex items-center gap-2 flex-wrap">
        <input
          aria-label={`${p.name} name`}
          defaultValue={p.name}
          disabled={busy}
          onBlur={(e) => { const v = e.target.value.trim(); if (v && v !== p.name) patch(p, { name: v }); }}
          className="h-8 flex-1 min-w-[160px] rounded border border-input bg-background px-2 text-sm font-medium"
        />
        <Button type="button" size="sm" variant="outline" className="h-8 text-xs" disabled={busy} onClick={onDone}>
          Done
        </Button>
        <button
          type="button"
          disabled={busy}
          onClick={() => remove(p)}
          aria-label={`Delete ${p.name}`}
          className="text-destructive hover:text-destructive/80 text-xs px-1"
        >
          ✕
        </button>
      </div>

      <div className="flex items-center gap-2 flex-wrap">
        <select
          aria-label={`${p.name} category`}
          value={p.category}
          disabled={busy}
          onChange={(e) => patch(p, { category: e.target.value })}
          className={selectClass}
        >
          {CATEGORIES.map((c) => <option key={c.value} value={c.value}>{c.label}</option>)}
        </select>
        <select
          aria-label={`${p.name} unit`}
          value={p.default_unit}
          disabled={busy}
          onChange={(e) => patch(p, { default_unit: e.target.value })}
          className={selectClass}
        >
          {UNITS.map((u) => <option key={u.value} value={u.value}>{u.label}</option>)}
        </select>
        <div className="flex items-center gap-1">
          <span className="text-xs text-muted-foreground">{symbol}</span>
          <input
            type="number"
            step="0.01"
            min="0"
            aria-label={`${p.name} base price`}
            defaultValue={p.unit_price}
            disabled={busy}
            onBlur={(e) => { const v = e.target.value.trim(); if (v !== "" && v !== p.unit_price) patch(p, { unit_price: v }); }}
            className="h-8 w-24 rounded border border-input bg-background px-2 text-sm"
          />
        </div>
        <label className="flex items-center gap-1 text-xs text-muted-foreground">
          <input
            type="checkbox"
            checked={p.is_taxable}
            disabled={busy}
            onChange={(e) => patch(p, { is_taxable: e.target.checked })}
          />
          Taxable
        </label>
        <button
          type="button"
          disabled={busy}
          onClick={() => patch(p, { is_featured: !p.is_featured })}
          aria-pressed={p.is_featured}
          className={`text-xs px-2 py-1 rounded border ${p.is_featured ? "bg-primary/10 text-primary border-primary/30" : "border-input text-muted-foreground"}`}
        >
          {p.is_featured ? "Featured" : "Feature"}
        </button>
        <button
          type="button"
          disabled={busy}
          onClick={() => patch(p, { is_active: !p.is_active })}
          className={`text-xs px-2 py-1 rounded border ${p.is_active ? "border-input text-foreground" : "bg-muted text-muted-foreground border-input"}`}
        >
          {p.is_active ? "Active" : "Hidden"}
        </button>
      </div>

      <div className="pl-3 border-l-2 border-border space-y-1">
        {p.variants.map((v) => (
          <div key={v.id} className="flex items-center gap-2 flex-wrap">
            <input
              aria-label="Variant name"
              defaultValue={v.name}
              disabled={busy}
              placeholder="Variant name…"
              onBlur={(e) => { const val = e.target.value.trim(); if (val !== v.name) patchVariant(p, v, { name: val }); }}
              className="h-8 flex-1 min-w-[120px] rounded border border-input bg-background px-2 text-sm"
            />
            <input
              type="number"
              step="0.01"
              min="0"
              aria-label="Variant price"
              defaultValue={v.unit_price ?? ""}
              placeholder={`Inherits ${p.unit_price}`}
              disabled={busy}
              onBlur={(e) => {
                const raw = e.target.value.trim();
                const next = raw === "" ? null : raw;
                if (next !== v.unit_price) patchVariant(p, v, { unit_price: next });
              }}
              className="h-8 w-28 rounded border border-input bg-background px-2 text-sm"
            />
            <button
              type="button"
              disabled={busy}
              onClick={() => removeVariant(p, v)}
              aria-label={`Delete variant ${v.name || "unnamed"}`}
              className="text-destructive hover:text-destructive/80 text-xs px-1"
            >
              ✕
            </button>
          </div>
        ))}
        <Button type="button" size="sm" variant="ghost" disabled={busy} onClick={() => addVariant(p)} className="h-7 text-xs">
          + Add variant
        </Button>
      </div>
    </div>
  );
}
