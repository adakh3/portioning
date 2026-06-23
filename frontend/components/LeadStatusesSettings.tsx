"use client";

import { useState } from "react";
import {
  DndContext,
  closestCenter,
  PointerSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
} from "@dnd-kit/core";
import {
  SortableContext,
  verticalListSortingStrategy,
  useSortable,
  arrayMove,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { api, ChoiceOption } from "@/lib/api";
import { useManagedLeadStatuses, revalidate } from "@/lib/hooks";
import { STATUS_COLOR_TOKENS, statusColor } from "@/lib/statusColors";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

/** Manage the org's lead pipeline stages (Settings). Edits the same
 * LeadStatusOption rows as Django admin. First instance of the in-app
 * org-config pattern. */
export default function LeadStatusesSettings() {
  const { data: statuses = [], mutate, isLoading } = useManagedLeadStatuses();
  const [newLabel, setNewLabel] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const ordered = [...statuses].sort((a, b) => a.sort_order - b.sort_order || a.id - b.id);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
  );

  async function run(fn: () => Promise<unknown>) {
    setBusy(true);
    setError("");
    try {
      await fn();
      await mutate();
      revalidate("lead-statuses"); // refresh kanban/dropdowns elsewhere
    } catch (e) {
      setError(e instanceof Error ? e.message : "Something went wrong");
    } finally {
      setBusy(false);
    }
  }

  const patch = (s: ChoiceOption, data: Partial<ChoiceOption>) =>
    run(() => api.updateLeadStatus(s.id, data));

  const add = () => {
    const label = newLabel.trim();
    if (!label) return;
    setNewLabel("");
    return run(() => api.createLeadStatus({ label, sort_order: (ordered.at(-1)?.sort_order ?? 0) + 1 }));
  };

  const remove = (s: ChoiceOption) => run(() => api.deleteLeadStatus(s.id));

  function handleDragEnd(event: DragEndEvent) {
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    const from = ordered.findIndex((s) => s.id === active.id);
    const to = ordered.findIndex((s) => s.id === over.id);
    if (from < 0 || to < 0) return;
    const reordered = arrayMove(ordered, from, to);
    // Optimistically reflect the new order, then persist sort_order for each row.
    mutate(reordered.map((s, i) => ({ ...s, sort_order: i })), { revalidate: false });
    run(async () => {
      for (let i = 0; i < reordered.length; i++) {
        if (reordered[i].sort_order !== i) {
          await api.updateLeadStatus(reordered[i].id, { sort_order: i });
        }
      }
    });
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Lead Statuses</CardTitle>
      </CardHeader>
      <CardContent>
        <p className="text-xs text-muted-foreground mb-4">
          Customise your lead pipeline stages. These drive the kanban columns and status dropdowns.
          Drag the handle to reorder. The <strong>Default</strong> stage is where new leads start;
          <strong> Won</strong> converts to an event; <strong>Lost</strong> asks for a reason.
        </p>
        {error && <p className="text-destructive text-sm mb-3">{error}</p>}
        {isLoading ? (
          <p className="text-muted-foreground text-sm">Loading…</p>
        ) : (
          <div className="space-y-2">
            <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
              <SortableContext items={ordered.map((s) => s.id)} strategy={verticalListSortingStrategy}>
                {ordered.map((s) => (
                  <StatusRow key={s.id} status={s} busy={busy} onPatch={patch} onRemove={remove} />
                ))}
              </SortableContext>
            </DndContext>

            {/* Add new */}
            <div className="flex items-center gap-2 pt-2">
              <Input
                placeholder="New status name…"
                value={newLabel}
                disabled={busy}
                onChange={(e) => setNewLabel(e.target.value)}
                onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); add(); } }}
                className="h-8 max-w-xs"
              />
              <Button type="button" size="sm" variant="outline" disabled={busy || !newLabel.trim()} onClick={add}>
                + Add status
              </Button>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function StatusRow({ status: s, busy, onPatch, onRemove }: {
  status: ChoiceOption;
  busy: boolean;
  onPatch: (s: ChoiceOption, data: Partial<ChoiceOption>) => void;
  onRemove: (s: ChoiceOption) => void;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: s.id });
  const style = { transform: CSS.Transform.toString(transform), transition, opacity: isDragging ? 0.6 : 1 };

  return (
    <div
      ref={setNodeRef}
      style={style}
      className="flex items-center gap-2 flex-wrap border border-border rounded-md p-2 bg-background"
    >
      {/* Drag handle */}
      <button
        type="button"
        aria-label="Drag to reorder"
        {...attributes}
        {...listeners}
        className="cursor-grab active:cursor-grabbing text-muted-foreground hover:text-foreground touch-none px-1"
      >
        <svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor" aria-hidden="true">
          <circle cx="5" cy="3" r="1.4" /><circle cx="11" cy="3" r="1.4" />
          <circle cx="5" cy="8" r="1.4" /><circle cx="11" cy="8" r="1.4" />
          <circle cx="5" cy="13" r="1.4" /><circle cx="11" cy="13" r="1.4" />
        </svg>
      </button>

      {/* Colour swatches */}
      <div className="flex gap-1">
        {STATUS_COLOR_TOKENS.map((c) => (
          <button key={c} type="button" title={c} disabled={busy}
            onClick={() => onPatch(s, { color: c })}
            className={`h-4 w-4 rounded-full ${statusColor(c).dot} ${s.color === c ? "ring-2 ring-offset-1 ring-ring" : "opacity-60 hover:opacity-100"}`} />
        ))}
      </div>

      {/* Label (save on blur) */}
      <input
        defaultValue={s.label}
        disabled={busy}
        onBlur={(e) => { const v = e.target.value.trim(); if (v && v !== s.label) onPatch(s, { label: v }); }}
        className="h-8 flex-1 min-w-[120px] rounded border border-input bg-transparent px-2 text-sm"
      />

      {/* Semantic flags */}
      <div className="flex gap-1">
        {(["is_default", "is_won", "is_lost"] as const).map((flag) => {
          const labels = { is_default: "Default", is_won: "Won", is_lost: "Lost" };
          const on = !!s[flag];
          return (
            <button key={flag} type="button" disabled={busy}
              onClick={() => onPatch(s, { [flag]: !on })}
              className={`text-xs px-2 py-1 rounded border ${on ? "bg-primary text-primary-foreground border-primary" : "border-input text-muted-foreground hover:bg-muted"}`}>
              {labels[flag]}
            </button>
          );
        })}
      </div>

      {/* Active toggle */}
      <button type="button" disabled={busy}
        onClick={() => onPatch(s, { is_active: !s.is_active })}
        className={`text-xs px-2 py-1 rounded border ${s.is_active ? "border-input text-foreground" : "bg-muted text-muted-foreground border-input"}`}>
        {s.is_active ? "Active" : "Hidden"}
      </button>

      {/* Delete */}
      <button type="button" disabled={busy}
        onClick={() => onRemove(s)}
        className="text-destructive hover:text-destructive/80 text-xs px-1">✕</button>
    </div>
  );
}
