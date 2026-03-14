"use client";

import { useState, useEffect } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import { api, CalculationResult, EventDishComment } from "@/lib/api";
import { useEvent, useDishes } from "@/lib/hooks";
import { revalidate } from "@/lib/hooks";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";

const statusBadgeVariant: Record<string, "warning" | "info" | "secondary" | "success" | "destructive"> = {
  tentative: "warning",
  confirmed: "info",
  in_progress: "secondary",
  completed: "success",
  cancelled: "destructive",
};

const poolOrder = ["protein", "accompaniment", "dessert", "service"];
const poolLabels: Record<string, string> = {
  protein: "Protein",
  accompaniment: "Accompaniments",
  dessert: "Desserts",
  service: "Service Items",
};

interface DishRow {
  dish_id: number;
  dish_name: string;
  category: string;
  pool: string;
  portion_grams: number | null;
  engine_grams: number | null;
}

export default function KitchenEventDetailPage() {
  const { id } = useParams<{ id: string }>();
  const eventId = Number(id);
  const { data: event, error, isLoading, mutate: mutateEvent } = useEvent(eventId);
  const { data: allDishes = [] } = useDishes();

  const [rows, setRows] = useState<DishRow[]>([]);
  const [saving, setSaving] = useState(false);
  const [recalculating, setRecalculating] = useState(false);
  const [saveMessage, setSaveMessage] = useState<string | null>(null);

  // Build rows when event loads
  useEffect(() => {
    if (!event || allDishes.length === 0) return;

    const dishMap = new Map(allDishes.map((d) => [d.id, d]));
    const commentMap = new Map(
      (event.dish_comments || []).map((dc) => [dc.dish_id, dc])
    );

    const built: DishRow[] = event.dishes.map((dishId) => {
      const dish = dishMap.get(dishId);
      const comment = commentMap.get(dishId);
      return {
        dish_id: dishId,
        dish_name: dish?.name || `Dish #${dishId}`,
        category: dish?.category_name || "",
        pool: "", // Will be filled by engine results or left blank
        portion_grams: comment?.portion_grams ?? null,
        engine_grams: null,
      };
    });

    setRows(built);
  }, [event, allDishes]);

  const handlePortionChange = (dishId: number, value: string) => {
    const num = value === "" ? null : parseFloat(value);
    setRows((prev) =>
      prev.map((r) =>
        r.dish_id === dishId ? { ...r, portion_grams: num } : r
      )
    );
    setSaveMessage(null);
  };

  const handleSave = async () => {
    if (!event) return;
    setSaving(true);
    setSaveMessage(null);
    try {
      const dish_comments: EventDishComment[] = rows
        .filter((r) => r.portion_grams != null)
        .map((r) => ({
          dish_id: r.dish_id,
          portion_grams: r.portion_grams!,
          comment: "",
        }));
      await api.updateEvent(eventId, { dish_comments });
      mutateEvent();
      revalidate(`event-${eventId}`);
      setSaveMessage("Portions saved.");
    } catch (err: unknown) {
      setSaveMessage(`Error saving: ${err instanceof Error ? err.message : err}`);
    } finally {
      setSaving(false);
    }
  };

  const handleRecalculate = async () => {
    if (!event) return;
    setRecalculating(true);
    setSaveMessage(null);
    try {
      const result: CalculationResult = await api.calculateEvent(eventId);
      // Update engine_grams and pool from engine results
      const engineMap = new Map(
        result.portions.map((p) => [p.dish_id, p])
      );
      setRows((prev) =>
        prev.map((r) => {
          const eng = engineMap.get(r.dish_id);
          return {
            ...r,
            engine_grams: eng?.grams_per_person ?? null,
            pool: eng?.pool || r.pool,
          };
        })
      );
      setSaveMessage("Engine recommendations refreshed. Review and save to apply.");
    } catch (err: unknown) {
      setSaveMessage(`Error recalculating: ${err instanceof Error ? err.message : err}`);
    } finally {
      setRecalculating(false);
    }
  };

  const applyEngineValues = () => {
    setRows((prev) =>
      prev.map((r) => ({
        ...r,
        portion_grams: r.engine_grams ?? r.portion_grams,
      }))
    );
    setSaveMessage("Engine values applied. Click Save to persist.");
  };

  if (isLoading) return <p className="text-muted-foreground p-6">Loading event...</p>;
  if (error) return <div className="bg-destructive/10 border border-destructive/20 text-destructive px-4 py-3 rounded m-6">{error.message}</div>;
  if (!event) return <p className="text-muted-foreground p-6">Event not found.</p>;

  // Group rows by pool
  const grouped = poolOrder
    .map((pool) => ({
      pool,
      label: poolLabels[pool] || pool,
      dishes: rows.filter((r) => r.pool === pool),
    }))
    .filter((g) => g.dishes.length > 0);

  // If no pool info yet, show ungrouped
  const ungrouped = rows.filter(
    (r) => !r.pool || !poolOrder.includes(r.pool)
  );

  const totalGuests = event.gents + event.ladies;

  return (
    <div className="space-y-6">
      <Button variant="outline" size="sm" asChild>
        <Link href="/kitchen/events">&larr; Back to Kitchen Events</Link>
      </Button>

      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <div className="flex items-center gap-3">
            <h1 className="text-2xl font-bold text-foreground">{event.name}</h1>
            <Badge variant={statusBadgeVariant[event.status] || "secondary"} className="rounded-full">
              {event.status_display || event.status}
            </Badge>
          </div>
          <div className="flex items-center gap-4 mt-1 text-sm text-muted-foreground">
            <span>{event.date}</span>
            <span>{totalGuests} guests ({event.gents}G / {event.ladies}L)</span>
            {event.venue_name && <span>{event.venue_name}</span>}
            {event.account_name && <span>{event.account_name}</span>}
          </div>
        </div>
      </div>

      {/* Action buttons */}
      <div className="flex items-center gap-3">
        <Button onClick={handleSave} disabled={saving}>
          {saving ? "Saving..." : "Save Portions"}
        </Button>
        <Button variant="outline" onClick={handleRecalculate} disabled={recalculating}>
          {recalculating ? "Calculating..." : "Recalculate"}
        </Button>
        {rows.some((r) => r.engine_grams != null) && (
          <Button variant="outline" onClick={applyEngineValues}>
            Apply Engine Values
          </Button>
        )}
        {saveMessage && (
          <span className={`text-sm ${saveMessage.startsWith("Error") ? "text-destructive" : "text-muted-foreground"}`}>
            {saveMessage}
          </span>
        )}
      </div>

      {/* Portions table */}
      <Card>
        <CardContent className="p-0">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border bg-muted/50">
                <th className="text-left p-3 font-medium text-muted-foreground">Dish</th>
                <th className="text-left p-3 font-medium text-muted-foreground">Category</th>
                <th className="text-right p-3 font-medium text-muted-foreground">Engine (g/person)</th>
                <th className="text-right p-3 font-medium text-muted-foreground w-36">Portion (g/person)</th>
                <th className="text-right p-3 font-medium text-muted-foreground">Total (kg)</th>
              </tr>
            </thead>
            <tbody>
              {grouped.map((group) => (
                <PoolGroup
                  key={group.pool}
                  label={group.label}
                  dishes={group.dishes}
                  totalGuests={totalGuests}
                  onPortionChange={handlePortionChange}
                />
              ))}
              {ungrouped.length > 0 && (
                <PoolGroup
                  label={grouped.length > 0 ? "Other" : "Dishes"}
                  dishes={ungrouped}
                  totalGuests={totalGuests}
                  onPortionChange={handlePortionChange}
                />
              )}
            </tbody>
          </table>
        </CardContent>
      </Card>

      {/* Event notes */}
      {event.notes && (
        <Card>
          <CardContent className="p-4">
            <h3 className="text-sm font-medium text-muted-foreground mb-2">Event Notes</h3>
            <p className="text-sm text-foreground whitespace-pre-wrap">{event.notes}</p>
          </CardContent>
        </Card>
      )}
    </div>
  );
}

function PoolGroup({
  label,
  dishes,
  totalGuests,
  onPortionChange,
}: {
  label: string;
  dishes: DishRow[];
  totalGuests: number;
  onPortionChange: (dishId: number, value: string) => void;
}) {
  return (
    <>
      <tr className="bg-muted/30">
        <td colSpan={5} className="p-2 px-3 font-semibold text-foreground text-xs uppercase tracking-wide">
          {label}
        </td>
      </tr>
      {dishes.map((row) => {
        const totalKg = row.portion_grams != null
          ? ((row.portion_grams * totalGuests) / 1000).toFixed(1)
          : "—";
        return (
          <tr key={row.dish_id} className="border-b border-border/50 hover:bg-muted/20">
            <td className="p-3 text-foreground">{row.dish_name}</td>
            <td className="p-3 text-muted-foreground">{row.category}</td>
            <td className="p-3 text-right text-muted-foreground">
              {row.engine_grams != null ? `${row.engine_grams}g` : "—"}
            </td>
            <td className="p-3 text-right">
              <Input
                type="number"
                step="0.1"
                className="w-24 ml-auto text-right h-8"
                value={row.portion_grams ?? ""}
                onChange={(e) => onPortionChange(row.dish_id, e.target.value)}
                placeholder="—"
              />
            </td>
            <td className="p-3 text-right text-muted-foreground">{totalKg} kg</td>
          </tr>
        );
      })}
    </>
  );
}
