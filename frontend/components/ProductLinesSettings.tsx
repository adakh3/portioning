"use client";

import { useState } from "react";
import { api, ProductLine } from "@/lib/api";
import { useManagedProductLines, revalidate } from "@/lib/hooks";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

const PALETTE = ["#EF4444", "#F59E0B", "#10B981", "#3B82F6", "#8B5CF6", "#EC4899", "#6366F1", "#14B8A6"];

/** Manage product lines (Settings, manager/owner): create, rename, recolour,
 * deactivate, delete. Colour drives the calendar + lead kanban. */
export default function ProductLinesSettings() {
  const { data: lines = [], mutate, isLoading } = useManagedProductLines();
  const [newName, setNewName] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function run(fn: () => Promise<unknown>) {
    setBusy(true);
    setError("");
    try {
      await fn();
      await mutate();
      revalidate("product-lines"); // refresh calendar/kanban
    } catch (e) {
      setError(e instanceof Error ? e.message : "Something went wrong");
    } finally {
      setBusy(false);
    }
  }

  const patch = (l: ProductLine, data: Partial<ProductLine>) =>
    run(() => api.updateManagedProductLine(l.id, data));
  const remove = (l: ProductLine) => run(() => api.deleteProductLine(l.id));
  const add = () => {
    const name = newName.trim();
    if (!name) return;
    setNewName("");
    return run(() => api.createProductLine({ name, colour: "#6B7280" }));
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle>Product Lines</CardTitle>
      </CardHeader>
      <CardContent>
        <p className="text-xs text-muted-foreground mb-4">
          Business/service lines (e.g. Weddings, Corporate). The colour is used on the calendar and
          lead kanban; product lines also drive round-robin lead assignment.
        </p>
        {error && <p className="text-destructive text-sm mb-3">{error}</p>}
        {isLoading ? (
          <p className="text-muted-foreground text-sm">Loading…</p>
        ) : (
          <div className="space-y-2">
            {lines.map((l) => (
              <div key={l.id} className="flex items-center gap-2 border border-border rounded-md p-2 flex-wrap">
                <input
                  type="color"
                  value={l.colour || "#6B7280"}
                  disabled={busy}
                  onChange={(e) => patch(l, { colour: e.target.value })}
                  className="h-8 w-8 rounded-md border border-input cursor-pointer p-0.5"
                  aria-label={`${l.name} colour`}
                />
                <input
                  defaultValue={l.name}
                  disabled={busy}
                  onBlur={(e) => { const v = e.target.value.trim(); if (v && v !== l.name) patch(l, { name: v }); }}
                  className="h-8 flex-1 min-w-[140px] rounded border border-input bg-transparent px-2 text-sm"
                />
                <div className="flex gap-1">
                  {PALETTE.map((c) => (
                    <button key={c} type="button" title={c} disabled={busy}
                      onClick={() => patch(l, { colour: c })}
                      className="h-5 w-5 rounded-full border border-border hover:ring-2 hover:ring-ring transition-shadow"
                      style={{ backgroundColor: c }} />
                  ))}
                </div>
                <button type="button" disabled={busy} onClick={() => patch(l, { is_active: !l.is_active })}
                  className={`text-xs px-2 py-1 rounded border ${l.is_active ? "border-input text-foreground" : "bg-muted text-muted-foreground border-input"}`}>
                  {l.is_active ? "Active" : "Hidden"}
                </button>
                <button type="button" disabled={busy} onClick={() => patch(l, { is_default: !l.is_default })}
                  title="Pre-selected on new quotes/events (only one)"
                  className={`text-xs px-2 py-1 rounded border ${l.is_default ? "bg-primary/10 text-primary border-primary/30" : "border-input text-muted-foreground"}`}>
                  {l.is_default ? "Default" : "Set default"}
                </button>
                <button type="button" disabled={busy} onClick={() => remove(l)}
                  className="text-destructive hover:text-destructive/80 text-xs px-1">✕</button>
              </div>
            ))}

            <div className="flex items-center gap-2 pt-2">
              <Input
                placeholder="New product line…"
                value={newName}
                disabled={busy}
                onChange={(e) => setNewName(e.target.value)}
                onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); add(); } }}
                className="h-8 max-w-xs"
              />
              <Button type="button" size="sm" variant="outline" disabled={busy || !newName.trim()} onClick={add}>
                + Add product line
              </Button>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
