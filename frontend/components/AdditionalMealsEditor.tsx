"use client";

import { EventMealData } from "@/lib/api";
import { formatDate, formatTime, todayISO } from "@/lib/dateFormat";
import { deriveMealCount, GuestSegmentMeta } from "@/lib/quoteTotals";
import MenuBuilder from "@/components/MenuBuilder";
import TimeField from "@/components/TimeField";
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
  timeFormat = "24h",
  guestCount = 0,
  segmentCounts = {},
  segmentMeta = [],
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
  /** Org time-entry preference ("12h"/"24h"). */
  timeFormat?: "12h" | "24h";
  /** The booking's canonical guest count — audience meals derive from it. */
  guestCount?: number;
  /** Explicit per-segment counts entered on the Guests section (default derived). */
  segmentCounts?: Record<string, number>;
  /** The org's guest segments — populate the "Serves" selector (data-driven). */
  segmentMeta?: GuestSegmentMeta[];
}) {
  const patch = (idx: number, fields: Partial<EventMealData>) =>
    onChange(meals.map((m, i) => (i === idx ? { ...m, ...fields } : m)));

  // "Serves" options: Everyone / Guests only / Custom, plus one per segment that is
  // actually USED on this booking — so an org that has segments but isn't splitting
  // this booking sees a clean list, not zero-count segments. A segment counts as used
  // if it has an entered count; the default (Adults) shows only once a breakdown
  // exists. Data-driven, so a Gents/Ladies org sees its own segments.
  const splitting = segmentMeta.some((m) => m.counts_toward_total && !m.is_default && (segmentCounts[m.name] || 0) > 0);
  const usedSegmentNames = new Set(
    segmentMeta
      .filter((s) => (s.is_default && s.counts_toward_total ? splitting : (segmentCounts[s.name] || 0) > 0))
      .map((s) => s.name),
  );
  const audienceOptionsFor = (m: EventMealData) => {
    const names = new Set(usedSegmentNames);
    // Always keep this meal's own segment selectable, even if its count dropped to 0,
    // so the control never loses its current value.
    if ((m.audience || "") === "segment" && m.audience_segment) names.add(m.audience_segment);
    const segs = [...segmentMeta].sort((a, b) => a.sort_order - b.sort_order).filter((s) => names.has(s.name));
    return [
      { value: "everyone", label: "Everyone" },
      { value: "guests", label: "Guests only" },
      ...segs.map((s) => ({ value: `seg:${s.name}`, label: s.name })),
      { value: "custom", label: "Custom number" },
    ];
  };
  const servesValue = (m: EventMealData) =>
    (m.audience || "custom") === "segment" ? `seg:${m.audience_segment ?? ""}` : (m.audience || "custom");
  const onServes = (idx: number, value: string) => {
    if (value.startsWith("seg:")) patch(idx, { audience: "segment", audience_segment: value.slice(4) });
    else patch(idx, { audience: value, audience_segment: null });
  };
  const servedByLabel = (m: EventMealData) => {
    const a = m.audience || "custom";
    if (a === "everyone") return "Everyone";
    if (a === "guests") return "Guests only";
    if (a === "segment") return m.audience_segment || "—";
    return "Custom";
  };

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
                label: "", audience: "everyone", audience_segment: null,
                guest_count: defaultGuestCount, price_per_head: null, dishes: [],
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
                  <label className="block text-sm font-medium text-foreground mb-1">Serves</label>
                  {editing ? (
                    <>
                      <select
                        aria-label="Serves"
                        value={servesValue(meal)}
                        onChange={(e) => onServes(idx, e.target.value)}
                        className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                      >
                        {audienceOptionsFor(meal).map((o) => (
                          <option key={o.value} value={o.value}>{o.label}</option>
                        ))}
                      </select>
                      {(meal.audience || "custom") === "custom" ? (
                        <div className="mt-2">
                          <ValidatedInput
                            aria-label="Guest count"
                            type="number"
                            min={0}
                            value={meal.guest_count}
                            onChange={(e) => patch(idx, { guest_count: parseInt(e.target.value) || 0 })}
                          />
                        </div>
                      ) : (
                        <p className="mt-2 text-sm text-muted-foreground">
                          {deriveMealCount(meal, guestCount, segmentCounts, segmentMeta)} — from {servedByLabel(meal)}
                        </p>
                      )}
                    </>
                  ) : (
                    <span className="text-sm">
                      {deriveMealCount(meal, guestCount, segmentCounts, segmentMeta)}
                      {(meal.audience || "custom") !== "custom" && (
                        <span className="text-muted-foreground"> — {servedByLabel(meal)}</span>
                      )}
                    </span>
                  )}
                </div>
                <div>
                  <label className="block text-sm font-medium text-foreground mb-1">Meal Time</label>
                  {editing ? (
                    <TimeField
                      ariaLabel="Additional meal time"
                      format={timeFormat}
                      value={meal.meal_time && meal.meal_time.includes("T") ? meal.meal_time.slice(11, 16) : ""}
                      onChange={(time) => {
                        if (!time) { patch(idx, { meal_time: null }); return; }
                        const existingDate = meal.meal_time && meal.meal_time.includes("T") ? meal.meal_time.slice(0, 10) : "";
                        const date = existingDate || eventDate || todayISO();
                        patch(idx, { meal_time: `${date}T${time}` });
                      }}
                    />
                  ) : (
                    /* Rendered as STORED, not converted into the viewer's zone
                       (REL-447). `formatDateTime` runs the value through
                       `new Date()`; the API serves UTC, so a 19:00 meal read as
                       20:00 in London and 15:00 in New York — while the Timeline
                       card on the SAME page and the PDF both said 19:00. Caught by
                       driving the real app: one meal, two times, one screen. */
                    <span className="text-sm">
                      {meal.meal_time
                        ? `${formatDate(`${meal.meal_time.slice(0, 10)}T12:00:00`, dateFormat)}, ${formatTime(meal.meal_time, timeFormat)}`
                        : "—"}
                    </span>
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
                guestCount={deriveMealCount(meal, guestCount, segmentCounts, segmentMeta)}
                currencySymbol={currencySymbol}
                priceRoundingStep={priceRoundingStep}
                disabled={!editing}
              />
              {editing && (
                /* The main meal splits its price by guest type; an extra meal charges
                   one rate to everyone it serves (REL-426 AC3 deferred per-segment
                   rates on extras). Say so, or the asymmetry with the Main Meal card
                   reads as a missing feature rather than a deliberate one. */
                <p className="text-xs text-muted-foreground">
                  One flat rate for everyone this meal serves — guest types aren&apos;t
                  priced separately on extra meals.
                </p>
              )}
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}
