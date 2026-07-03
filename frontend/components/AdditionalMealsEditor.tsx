"use client";

import { EventMealData } from "@/lib/api";
import { formatDateTime, todayISO } from "@/lib/dateFormat";
import MenuBuilder from "@/components/MenuBuilder";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { ValidatedInput } from "@/components/ui/validated-input";
import { Textarea } from "@/components/ui/textarea";

/** A booking's additional meals — welcome drinks, breakfast, a second service —
 * each with its own menu, guest count, price-per-head, time and notes. Shared by
 * the quote and event editors so both enter meals identically. Controlled. */
export default function AdditionalMealsEditor({
  meals,
  onChange,
  editing,
  currencySymbol,
  dateFormat,
  priceRoundingStep,
  defaultGuestCount = 0,
  eventDate,
}: {
  meals: EventMealData[];
  onChange: (meals: EventMealData[]) => void;
  editing: boolean;
  currencySymbol: string;
  dateFormat: string;
  priceRoundingStep?: number;
  /** New meals default their guest count to this (the booking's total guests). */
  defaultGuestCount?: number;
  /** The booking's event date ("YYYY-MM-DD"); meal times are anchored to it. */
  eventDate?: string;
}) {
  const patch = (idx: number, fields: Partial<EventMealData>) =>
    onChange(meals.map((m, i) => (i === idx ? { ...m, ...fields } : m)));

  return (
    <Card>
      <CardContent className="p-6">
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide">Additional Meals</h2>
          {editing && (
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => onChange([...meals, {
                label: "", guest_count: defaultGuestCount, price_per_head: null, dishes: [],
                based_on_template: null, meal_time: null, notes: "",
              }])}
            >
              + Add Meal
            </Button>
          )}
        </div>
        {meals.length === 0 && (
          <p className="text-sm text-muted-foreground">No additional meals{editing ? " added" : ""}.</p>
        )}
        <div className="space-y-4">
          {meals.map((meal, idx) => (
            <div key={idx} className="border border-border rounded-lg p-4 space-y-3">
              <div className="flex items-center justify-between gap-2">
                {editing ? (
                  <input
                    type="text"
                    placeholder="Meal label"
                    value={meal.label}
                    onChange={(e) => patch(idx, { label: e.target.value })}
                    className="flex h-9 rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring flex-1"
                  />
                ) : (
                  <span className="font-medium text-foreground">{meal.label || "Untitled Meal"}</span>
                )}
                {editing && (
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    className="text-destructive"
                    onClick={() => onChange(meals.filter((_, i) => i !== idx))}
                  >
                    Remove
                  </Button>
                )}
              </div>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                <div>
                  <label className="block text-sm font-medium text-foreground mb-1">Guest Count</label>
                  {editing ? (
                    <ValidatedInput
                      type="number"
                      min={0}
                      value={meal.guest_count}
                      onChange={(e) => patch(idx, { guest_count: parseInt(e.target.value) || 0 })}
                    />
                  ) : (
                    <span className="text-sm">{meal.guest_count}</span>
                  )}
                </div>
                <div>
                  <label className="block text-sm font-medium text-foreground mb-1">Meal Time</label>
                  {editing ? (
                    <>
                      <ValidatedInput
                        type="time"
                        aria-label="Additional meal time"
                        value={meal.meal_time && meal.meal_time.includes("T") ? meal.meal_time.slice(11, 16) : ""}
                        onChange={(e) => {
                          const time = e.target.value;
                          if (!time) { patch(idx, { meal_time: null }); return; }
                          const existingDate = meal.meal_time && meal.meal_time.includes("T") ? meal.meal_time.slice(0, 10) : "";
                          const date = existingDate || eventDate || todayISO();
                          patch(idx, { meal_time: `${date}T${time}` });
                        }}
                      />
                      {meal.meal_time && meal.meal_time.includes("T")
                        ? <span className="mt-1 block text-xs text-emerald-600">✓ {meal.meal_time.slice(11, 16)}</span>
                        : <span className="mt-1 block text-xs text-muted-foreground">Not set</span>}
                    </>
                  ) : (
                    <span className="text-sm">{meal.meal_time ? formatDateTime(meal.meal_time, dateFormat) : "—"}</span>
                  )}
                </div>
              </div>
              {editing && (
                <div>
                  <label className="block text-sm font-medium text-foreground mb-1">Notes</label>
                  <Textarea
                    value={meal.notes}
                    onChange={(e) => patch(idx, { notes: e.target.value })}
                    rows={2}
                    placeholder="Special instructions for this meal..."
                  />
                </div>
              )}
              {!editing && meal.notes && (
                <div>
                  <label className="block text-sm font-medium text-muted-foreground mb-1">Notes</label>
                  <p className="text-sm">{meal.notes}</p>
                </div>
              )}
              <MenuBuilder
                selectedDishIds={meal.dishes}
                basedOnTemplate={meal.based_on_template}
                onChange={(data) => patch(idx, { dishes: data.dish_ids, based_on_template: data.based_on_template })}
                pricePerHead={meal.price_per_head || ""}
                onPricePerHeadChange={editing ? (val) => patch(idx, { price_per_head: val || null }) : undefined}
                guestCount={meal.guest_count}
                currencySymbol={currencySymbol}
                priceRoundingStep={priceRoundingStep}
                disabled={!editing}
              />
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}
