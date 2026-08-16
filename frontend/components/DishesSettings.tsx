"use client";

import { useEffect, useMemo, useState } from "react";
import { api, Dish, DishCategory, DietaryTag } from "@/lib/api";
import { useManagedDishes, useCategories, useDietaryTags, useSiteSettings, revalidate } from "@/lib/hooks";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

// Shared column widths so the header lines up with each row.
const COL = {
  name: "flex-1 min-w-[140px]",
  category: "hidden sm:block w-28 shrink-0",
  cost: "w-24 shrink-0 text-right",
  surcharge: "hidden md:block w-24 shrink-0 text-right",
  tags: "hidden lg:block w-40 shrink-0",
  actions: "w-24 shrink-0 text-right",
};

type SortKey = "name" | "category" | "cost" | "surcharge";
type SortDir = "asc" | "desc";

const sortValue = (d: Dish, key: SortKey): string | number => {
  switch (key) {
    case "name": return d.name.toLowerCase();
    case "category": return (d.category_name || "").toLowerCase();
    case "cost": return Number(d.cost_per_gram || 0);
    case "surcharge": return Number(d.addition_surcharge || 0);
  }
};

const selectClass = "h-8 rounded border border-input bg-transparent px-2 text-sm";
const PAGE_SIZE = 25;

/** Manage the dish catalog (Settings, owner/admin): the client-facing surface —
 * name, category, cost, dietary tags, active, notes. Portioning/kitchen internals
 * stay admin-managed. Compact sortable table by default; a row expands into a card
 * editor only while being edited. Deleting is deactivate-first: a dish that's on a
 * booking can't be hard-deleted (the backend blocks it), only hidden. */
export default function DishesSettings() {
  const { data: dishes = [], mutate, isLoading } = useManagedDishes();
  const { data: categories = [] } = useCategories();
  const { data: tags = [] } = useDietaryTags();
  const { data: settings } = useSiteSettings();
  const symbol = settings?.currency_symbol ?? "";

  const [newName, setNewName] = useState("");
  const [editingId, setEditingId] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [search, setSearch] = useState("");
  const [categoryFilter, setCategoryFilter] = useState<number | "all">("all");
  const [sortKey, setSortKey] = useState<SortKey | null>(null);
  const [sortDir, setSortDir] = useState<SortDir>("asc");
  const [page, setPage] = useState(1);

  const toggleSort = (key: SortKey) => {
    if (sortKey === key) setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    else { setSortKey(key); setSortDir("asc"); }
  };

  const visible = useMemo(() => {
    const q = search.trim().toLowerCase();
    let rows = dishes.filter((d) =>
      (categoryFilter === "all" || d.category === categoryFilter) &&
      (!q || d.name.toLowerCase().includes(q)),
    );
    if (sortKey) {
      rows = [...rows].sort((a, b) => {
        const av = sortValue(a, sortKey), bv = sortValue(b, sortKey);
        const cmp = av < bv ? -1 : av > bv ? 1 : 0;
        return sortDir === "asc" ? cmp : -cmp;
      });
    }
    return rows;
  }, [dishes, search, categoryFilter, sortKey, sortDir]);

  // Paginate the filtered/sorted rows so a ~100-dish catalogue stays scannable.
  const pageCount = Math.max(1, Math.ceil(visible.length / PAGE_SIZE));
  const safePage = Math.min(page, pageCount);
  const pageRows = visible.slice((safePage - 1) * PAGE_SIZE, safePage * PAGE_SIZE);
  // Any change to the filter/sort resets to the first page.
  useEffect(() => { setPage(1); }, [search, categoryFilter, sortKey, sortDir]);

  async function run(fn: () => Promise<unknown>) {
    setBusy(true);
    setError("");
    try {
      await fn();
      await mutate();
      revalidate("dishes", "menus"); // the pickers, calculator and menus read dishes live
    } catch (e) {
      setError(e instanceof Error ? e.message : "Something went wrong");
    } finally {
      setBusy(false);
    }
  }

  const patch = (d: Dish, data: Partial<Dish>) => run(() => api.updateDish(d.id, data));
  const remove = (d: Dish) => {
    if (editingId === d.id) setEditingId(null);
    return run(() => api.deleteDish(d.id));
  };

  const add = async () => {
    const name = newName.trim();
    if (!name) return;
    const category = categoryFilter !== "all" ? categoryFilter : categories[0]?.id;
    if (!category) { setError("Add a dish category first (in admin) before creating dishes."); return; }
    setNewName("");
    const created = await api.createDish({ name, category, cost_per_gram: 0 })
      .catch((e) => { setError(e instanceof Error ? e.message : "Something went wrong"); return null; });
    await mutate();
    revalidate("dishes", "menus");
    if (created?.id) setEditingId(created.id);
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle>Dishes</CardTitle>
      </CardHeader>
      <CardContent>
        <p className="text-xs text-muted-foreground mb-4">
          Your dish catalogue — what can go on a menu, quote or event. Set a name, category,
          cost and dietary/allergen tags. Selling price and the per-head add/remove charge are
          worked out for you from the cost and your target food-cost&nbsp;%. A dish that&rsquo;s
          already on a booking can&rsquo;t be deleted (it would change that booking) — untick
          <em> Active</em> to retire it from new bookings instead.
        </p>
        {error && <p className="text-destructive text-sm mb-3" role="alert">{error}</p>}

        <div className="flex items-center gap-2 mb-3 flex-wrap">
          <Input
            placeholder="Search dishes…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="h-8 max-w-[200px]"
          />
          <select
            aria-label="Filter by category"
            value={categoryFilter}
            onChange={(e) => setCategoryFilter(e.target.value === "all" ? "all" : Number(e.target.value))}
            className={selectClass}
          >
            <option value="all">All categories</option>
            {categories.map((c) => <option key={c.id} value={c.id}>{c.display_name}</option>)}
          </select>
          <span className="text-xs text-muted-foreground">{visible.length} of {dishes.length}</span>
        </div>

        {isLoading ? (
          <p className="text-muted-foreground text-sm">Loading…</p>
        ) : (
          <div className="border border-border rounded-md divide-y divide-border">
            {dishes.length === 0 ? (
              <p className="text-muted-foreground text-sm px-3 py-4">No dishes yet.</p>
            ) : (
              <SortHeader sortKey={sortKey} sortDir={sortDir} onSort={toggleSort} />
            )}
            {pageRows.map((d) =>
              editingId === d.id ? (
                <DishEditor
                  key={d.id} d={d} symbol={symbol} busy={busy} categories={categories} tags={tags}
                  onDone={() => setEditingId(null)} patch={patch} remove={remove}
                />
              ) : (
                <DishRow
                  key={d.id} d={d} symbol={symbol} busy={busy}
                  onEdit={() => setEditingId(d.id)} onRemove={() => remove(d)}
                />
              ),
            )}
            {dishes.length > 0 && visible.length === 0 && (
              <p className="text-muted-foreground text-sm px-3 py-4">No dishes match.</p>
            )}

            {pageCount > 1 && (
              <div className="flex items-center justify-between gap-2 px-3 py-2 text-sm">
                <button
                  type="button"
                  onClick={() => setPage((p) => Math.max(1, p - 1))}
                  disabled={safePage <= 1}
                  className="text-xs px-2 py-1 rounded border border-input disabled:opacity-40"
                >
                  ← Prev
                </button>
                <span className="text-xs text-muted-foreground">Page {safePage} of {pageCount}</span>
                <button
                  type="button"
                  onClick={() => setPage((p) => Math.min(pageCount, p + 1))}
                  disabled={safePage >= pageCount}
                  className="text-xs px-2 py-1 rounded border border-input disabled:opacity-40"
                >
                  Next →
                </button>
              </div>
            )}

            <div className="flex items-center gap-2 px-3 py-2">
              <Input
                placeholder="New dish…"
                value={newName}
                disabled={busy}
                onChange={(e) => setNewName(e.target.value)}
                onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); add(); } }}
                className="h-8 max-w-xs"
              />
              <Button type="button" size="sm" variant="outline" disabled={busy || !newName.trim()} onClick={add}>
                + Add dish
              </Button>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

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
        <span className={active ? "text-primary" : "opacity-40 group-hover:opacity-70"} aria-hidden="true">
          {active ? (sortDir === "asc" ? "▲" : "▼") : "↕"}
        </span>
      </button>
    );
  };
  return (
    <div className="flex items-center gap-3 px-3 py-2 bg-muted/40">
      <Head k="name" label="Name" className={`${COL.name} justify-start`} />
      <Head k="category" label="Category" className={`${COL.category} justify-start`} />
      <Head k="cost" label="Cost/g" className={`${COL.cost} justify-end`} />
      <Head k="surcharge" label="Per head" className={`${COL.surcharge} justify-end`} />
      <span className={`${COL.tags} text-xs font-medium uppercase tracking-wide text-muted-foreground`}>Tags</span>
      <span className={COL.actions} aria-hidden="true" />
    </div>
  );
}

function DishRow({
  d, symbol, busy, onEdit, onRemove,
}: {
  d: Dish; symbol: string; busy: boolean; onEdit: () => void; onRemove: () => void;
}) {
  return (
    <div className="flex items-center gap-3 px-3 py-2 text-sm">
      <button
        type="button"
        onClick={onEdit}
        data-testid="dish-row-name"
        className={`${COL.name} font-medium text-left truncate hover:underline`}
        title="Edit"
      >
        {d.name}
        {d.is_active === false && <span className="ml-2 text-xs text-muted-foreground">(hidden)</span>}
      </button>
      <span className={`${COL.category} text-xs text-muted-foreground truncate`}>{d.category_name}</span>
      <span className={`${COL.cost} tabular-nums text-xs`}>{symbol}{d.cost_per_gram}</span>
      <span className={`${COL.surcharge} tabular-nums text-xs text-muted-foreground`}>
        {d.addition_surcharge != null ? `${symbol}${d.addition_surcharge}` : ""}
      </span>
      <span className={`${COL.tags} flex flex-wrap gap-1`}>
        {(d.dietary_tags ?? []).map((t) => (
          <span key={t.id} className="text-[10px] px-1 py-0.5 rounded bg-muted text-muted-foreground border border-border">
            {t.short_label || t.label}
          </span>
        ))}
      </span>
      <span className={`${COL.actions} flex items-center justify-end gap-1`}>
        <Button type="button" size="sm" variant="ghost" className="h-7 text-xs" disabled={busy} onClick={onEdit}>
          Edit
        </Button>
        <button
          type="button"
          disabled={busy}
          onClick={onRemove}
          aria-label={`Delete ${d.name}`}
          className="text-destructive hover:text-destructive/80 text-xs px-1"
        >
          ✕
        </button>
      </span>
    </div>
  );
}

function DishEditor({
  d, symbol, busy, categories, tags, onDone, patch, remove,
}: {
  d: Dish;
  symbol: string;
  busy: boolean;
  categories: DishCategory[];
  tags: DietaryTag[];
  onDone: () => void;
  patch: (d: Dish, data: Partial<Dish>) => void;
  remove: (d: Dish) => void;
}) {
  const selected = new Set((d.dietary_tags ?? []).map((t) => t.id));
  const toggleTag = (tagId: number) => {
    const next = new Set(selected);
    if (next.has(tagId)) next.delete(tagId); else next.add(tagId);
    patch(d, { dietary_tag_ids: [...next] });
  };

  return (
    <div className="p-3 space-y-2 bg-muted/40">
      <div className="flex items-center gap-2 flex-wrap">
        <input
          aria-label={`${d.name} name`}
          defaultValue={d.name}
          disabled={busy}
          onBlur={(e) => { const v = e.target.value.trim(); if (v && v !== d.name) patch(d, { name: v }); }}
          className="h-8 flex-1 min-w-[160px] rounded border border-input bg-background px-2 text-sm font-medium"
        />
        <Button type="button" size="sm" variant="outline" className="h-8 text-xs" disabled={busy} onClick={onDone}>
          Done
        </Button>
        <button
          type="button"
          disabled={busy}
          onClick={() => remove(d)}
          aria-label={`Delete ${d.name}`}
          className="text-destructive hover:text-destructive/80 text-xs px-1"
        >
          ✕
        </button>
      </div>

      <div className="flex items-center gap-2 flex-wrap">
        <select
          aria-label={`${d.name} category`}
          value={d.category}
          disabled={busy}
          onChange={(e) => patch(d, { category: Number(e.target.value) })}
          className={selectClass}
        >
          {categories.map((c) => <option key={c.id} value={c.id}>{c.display_name}</option>)}
        </select>
        <label className="flex items-center gap-1 text-xs text-muted-foreground">
          Cost / gram
          <span className="text-muted-foreground">{symbol}</span>
          <input
            type="number"
            step="0.0001"
            min="0"
            aria-label={`${d.name} cost per gram`}
            defaultValue={d.cost_per_gram}
            disabled={busy}
            onBlur={(e) => { const v = e.target.value.trim(); if (v !== "" && Number(v) !== Number(d.cost_per_gram)) patch(d, { cost_per_gram: Number(v) }); }}
            className="h-8 w-24 rounded border border-input bg-background px-2 text-sm"
          />
        </label>
        <span className="text-xs text-muted-foreground">
          Sell {symbol}{d.selling_price_per_gram ?? "—"}/g · Per head {symbol}{d.addition_surcharge ?? "—"}
        </span>
        <button
          type="button"
          disabled={busy}
          onClick={() => patch(d, { is_active: d.is_active === false })}
          className={`text-xs px-2 py-1 rounded border ${d.is_active === false ? "bg-muted text-muted-foreground border-input" : "border-input text-foreground"}`}
        >
          {d.is_active === false ? "Hidden" : "Active"}
        </button>
      </div>

      <div className="flex flex-wrap gap-1">
        {tags.map((t) => {
          const on = selected.has(t.id);
          return (
            <button
              key={t.id}
              type="button"
              disabled={busy}
              aria-pressed={on}
              aria-label={`${on ? "Remove" : "Add"} ${t.label}`}
              onClick={() => toggleTag(t.id)}
              className={`text-xs px-2 py-0.5 rounded border ${on ? "bg-primary/10 text-primary border-primary/30" : "border-input text-muted-foreground"}`}
            >
              {t.label}
            </button>
          );
        })}
      </div>

      <textarea
        aria-label={`${d.name} notes`}
        defaultValue={d.notes}
        disabled={busy}
        placeholder="Notes (optional)…"
        rows={2}
        onBlur={(e) => { const v = e.target.value; if (v !== d.notes) patch(d, { notes: v }); }}
        className="w-full rounded border border-input bg-background px-2 py-1 text-sm"
      />
    </div>
  );
}
