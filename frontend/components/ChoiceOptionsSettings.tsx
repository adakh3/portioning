"use client";

import { useState } from "react";
import {
  DndContext, closestCenter, PointerSensor, useSensor, useSensors, type DragEndEvent,
} from "@dnd-kit/core";
import {
  SortableContext, verticalListSortingStrategy, useSortable, arrayMove,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { api, ChoiceOption } from "@/lib/api";
import { useManagedChoices, revalidate } from "@/lib/hooks";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

/** Reusable Settings section to manage a simple org choice-option list
 * (event types, sources, service styles, meal types, lost reasons). Manager/owner
 * only on the API. Drag to reorder; rename keeps the underlying value stable. */
export default function ChoiceOptionsSettings({
  title, base, swrKey, revalidateKey, description, addPlaceholder = "New option…",
}: {
  title: string;
  base: string;          // management endpoint, e.g. "/bookings/settings/sources/"
  swrKey: string;        // SWR cache key for the managed list
  revalidateKey: string; // read-hook key to refresh dropdowns elsewhere
  description?: string;
  addPlaceholder?: string;
}) {
  const { data: options = [], mutate, isLoading } = useManagedChoices(swrKey, base);
  const [newLabel, setNewLabel] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 5 } }));

  const ordered = [...options].sort((a, b) => a.sort_order - b.sort_order || a.id - b.id);

  async function run(fn: () => Promise<unknown>) {
    setBusy(true);
    setError("");
    try {
      await fn();
      await mutate();
      revalidate(revalidateKey);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Something went wrong");
    } finally {
      setBusy(false);
    }
  }

  const add = () => {
    const label = newLabel.trim();
    if (!label) return;
    setNewLabel("");
    return run(() => api.createChoiceOption(base, { label, sort_order: (ordered.at(-1)?.sort_order ?? 0) + 1 }));
  };

  function handleDragEnd(e: DragEndEvent) {
    const { active, over } = e;
    if (!over || active.id === over.id) return;
    const from = ordered.findIndex((o) => o.id === active.id);
    const to = ordered.findIndex((o) => o.id === over.id);
    if (from < 0 || to < 0) return;
    const reordered = arrayMove(ordered, from, to);
    mutate(reordered.map((o, i) => ({ ...o, sort_order: i })), { revalidate: false });
    run(async () => {
      for (let i = 0; i < reordered.length; i++) {
        if (reordered[i].sort_order !== i) await api.updateChoiceOption(base, reordered[i].id, { sort_order: i });
      }
    });
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>{title}</CardTitle>
      </CardHeader>
      <CardContent>
        {description && <p className="text-xs text-muted-foreground mb-3">{description}</p>}
        {error && <p className="text-destructive text-sm mb-3">{error}</p>}
        {isLoading ? (
          <p className="text-muted-foreground text-sm">Loading…</p>
        ) : (
          <div className="space-y-2">
            <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
              <SortableContext items={ordered.map((o) => o.id)} strategy={verticalListSortingStrategy}>
                {ordered.map((o) => (
                  <OptionRow key={o.id} option={o} busy={busy}
                    onPatch={(data) => run(() => api.updateChoiceOption(base, o.id, data))}
                    onRemove={() => run(() => api.deleteChoiceOption(base, o.id))} />
                ))}
              </SortableContext>
            </DndContext>

            <div className="flex items-center gap-2 pt-2">
              <Input placeholder={addPlaceholder} value={newLabel} disabled={busy}
                onChange={(e) => setNewLabel(e.target.value)}
                onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); add(); } }}
                className="h-8 max-w-xs" />
              <Button type="button" size="sm" variant="outline" disabled={busy || !newLabel.trim()} onClick={add}>
                + Add
              </Button>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function OptionRow({ option: o, busy, onPatch, onRemove }: {
  option: ChoiceOption;
  busy: boolean;
  onPatch: (data: Partial<ChoiceOption>) => void;
  onRemove: () => void;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: o.id });
  const style = { transform: CSS.Transform.toString(transform), transition, opacity: isDragging ? 0.6 : 1 };
  return (
    <div ref={setNodeRef} style={style}
      className="flex items-center gap-2 border border-border rounded-md p-2 bg-background">
      <button type="button" aria-label="Drag to reorder" {...attributes} {...listeners}
        className="cursor-grab active:cursor-grabbing text-muted-foreground hover:text-foreground touch-none px-1">
        <svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor" aria-hidden="true">
          <circle cx="5" cy="3" r="1.4" /><circle cx="11" cy="3" r="1.4" />
          <circle cx="5" cy="8" r="1.4" /><circle cx="11" cy="8" r="1.4" />
          <circle cx="5" cy="13" r="1.4" /><circle cx="11" cy="13" r="1.4" />
        </svg>
      </button>
      <input defaultValue={o.label} disabled={busy}
        onBlur={(e) => { const v = e.target.value.trim(); if (v && v !== o.label) onPatch({ label: v }); }}
        className="h-8 flex-1 min-w-[120px] rounded border border-input bg-transparent px-2 text-sm" />
      <button type="button" disabled={busy} onClick={() => onPatch({ is_active: !o.is_active })}
        className={`text-xs px-2 py-1 rounded border ${o.is_active ? "border-input text-foreground" : "bg-muted text-muted-foreground border-input"}`}>
        {o.is_active ? "Active" : "Hidden"}
      </button>
      <button type="button" disabled={busy} onClick={onRemove}
        className="text-destructive hover:text-destructive/80 text-xs px-1">✕</button>
    </div>
  );
}
