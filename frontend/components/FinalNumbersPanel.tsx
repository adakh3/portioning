"use client";

import { useEffect, useState } from "react";
import { api, EventData } from "@/lib/api";
import { useDishes } from "@/lib/hooks";
import {
  ChoiceGroup, choiceTallyError, choiceTallyTotal, groupChoicesByCourse, offeredChoiceIds,
} from "@/lib/finals";
import { formatDate } from "@/lib/dateFormat";
import FinalsPill from "@/components/FinalsPill";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";

/** "Record final numbers" (REL-419) — where the final guarantee, its due date and
 * the per-dish tallies are entered together and saved once. This is the only place
 * the tallies are checked against the guarantee: at proposal time an offering has no
 * count and nothing to add up. The numbers are kitchen numbers — recording them
 * never moves the price, which is per head regardless of who picks what.
 *
 * Tallies are grouped and validated PER COURSE: every guest picks one dish from each
 * course that offers a choice, so a choice of main and a choice of dessert each add
 * up to the guarantee on their own. */
export default function FinalNumbersPanel({
  event,
  dateFormat,
  onSaved,
}: {
  event: EventData;
  dateFormat: string;
  onSaved: () => void;
}) {
  const { data: dishes = [] } = useDishes();
  const nameById: Record<number, string> = Object.fromEntries(dishes.map((d) => [d.id, d.name]));
  const groups: ChoiceGroup[] = groupChoicesByCourse(
    event.menu_choices, event.courses || [], event.dish_courses || {},
  );
  const offeredIds = offeredChoiceIds(event.menu_choices);  // the save payload

  const [open, setOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [guaranteed, setGuaranteed] = useState(
    event.guaranteed_count != null ? String(event.guaranteed_count) : "",
  );
  const [finalCount, setFinalCount] = useState(
    event.final_count != null ? String(event.final_count) : "",
  );
  const [dueDate, setDueDate] = useState(event.final_count_due || "");
  const [counts, setCounts] = useState<Record<string, string>>({});

  // Re-seed the tallies whenever the offered set or the stored counts change — the
  // panel outlives an edit of the menu above it, and state seeded once at mount
  // would keep showing (and summing) a dish that is no longer offered.
  const choicesKey = JSON.stringify(event.menu_choices || {});
  useEffect(() => {
    const stored: Record<string, number | null> = JSON.parse(choicesKey);
    setCounts((prev) =>
      Object.fromEntries(
        Object.keys(stored).map((k) => {
          const v = stored[k];
          // Keep what the owner has typed for a dish that is still offered.
          return [k, prev[k] !== undefined ? prev[k] : v != null ? String(v) : ""];
        }),
      ),
    );
  }, [choicesKey]);

  const guarantee = finalCount.trim() === "" ? null : parseInt(finalCount, 10);
  const groupErrors = groups.map((g) => choiceTallyError(counts, guarantee, g));
  const blocked =
    guarantee === null || Number.isNaN(guarantee) || groupErrors.some((e) => e !== null);

  async function save() {
    if (blocked) return;
    setSaving(true);
    setError("");
    try {
      await api.recordEventFinals(event.id, {
        final_count: guarantee!,
        final_count_due: dueDate || null,
        guaranteed_count: guaranteed.trim() === "" ? null : parseInt(guaranteed, 10),
        choice_counts: Object.fromEntries(
          offeredIds.map((id) => [String(id), parseInt(counts[String(id)], 10) || 0]),
        ),
      });
      setOpen(false);
      onSaved();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not save the final numbers.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <Card>
      <CardContent className="p-6" data-testid="finals-panel">
        <div className="flex items-center justify-between gap-3 mb-3">
          <div className="flex items-center gap-2">
            <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide">
              Final numbers
            </h2>
            <FinalsPill
              status={event.finals_status}
              dueDate={event.final_count_due}
              dateFormat={dateFormat}
            />
          </div>
          <Button type="button" variant="outline" size="sm" onClick={() => setOpen((v) => !v)}>
            {open ? "Close" : "Record final numbers"}
          </Button>
        </div>

        {!open ? (
          event.final_count != null ? (
            <dl className="grid grid-cols-2 md:grid-cols-3 gap-4 text-sm">
              <div>
                <dt className="text-muted-foreground">Final Count</dt>
                <dd className="font-medium">{event.final_count}</dd>
              </div>
              {event.guaranteed_count != null && (
                <div>
                  <dt className="text-muted-foreground">Guaranteed Count</dt>
                  <dd className="font-medium">{event.guaranteed_count}</dd>
                </div>
              )}
              {event.final_count_due && (
                <div>
                  <dt className="text-muted-foreground">Final Count Due</dt>
                  <dd className="font-medium">{formatDate(event.final_count_due, dateFormat)}</dd>
                </div>
              )}
              {/* Course order, so the summary reads the same way the panel above
                  it was filled in — not shuffled into dish-id order. */}
              {groups.flatMap((group) =>
                group.dishIds.map((id) => (
                  <div key={id}>
                    <dt className="text-muted-foreground">
                      {nameById[id] || `Dish ${id}`}
                      {group.courseName && (
                        <span className="ml-1 opacity-60">({group.courseName})</span>
                      )}
                    </dt>
                    <dd className="font-medium">{(event.menu_choices || {})[String(id)] ?? "—"}</dd>
                  </div>
                )),
              )}
            </dl>
          ) : (
            <p className="text-sm text-muted-foreground">
              Not recorded yet. The final guarantee is usually confirmed 2–4 weeks out
              {event.final_count_due ? ` — due ${formatDate(event.final_count_due, dateFormat)}` : ""}.
            </p>
          )
        ) : (
          <div className="space-y-4">
            <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
              <label className="text-sm">
                <span className="block font-medium mb-1">Final guarantee</span>
                <Input
                  type="number"
                  min={0}
                  aria-label="Final guarantee"
                  value={finalCount}
                  onChange={(e) => setFinalCount(e.target.value)}
                />
              </label>
              <label className="text-sm">
                <span className="block font-medium mb-1">Guaranteed count</span>
                <Input
                  type="number"
                  min={0}
                  aria-label="Guaranteed count"
                  value={guaranteed}
                  onChange={(e) => setGuaranteed(e.target.value)}
                />
              </label>
              <label className="text-sm">
                <span className="block font-medium mb-1">Final count due</span>
                <Input
                  type="date"
                  aria-label="Final count due"
                  value={dueDate}
                  onChange={(e) => setDueDate(e.target.value)}
                />
              </label>
            </div>

            {groups.map((group, gi) => {
              const total = choiceTallyTotal(counts, group.dishIds);
              const groupError = groupErrors[gi];
              return (
                <div key={gi} data-testid={`choice-group-${gi}`}>
                  <p className="text-sm font-medium mb-2">
                    {group.courseName || "Menu choices"}{" "}
                    <span className="font-normal text-muted-foreground">
                      — must add up to the final guarantee
                    </span>
                  </p>
                  <div className="space-y-1.5">
                    {group.dishIds.map((id) => (
                      <div key={id} className="flex items-center gap-2">
                        <span className="text-sm flex-1">{nameById[id] || `Dish ${id}`}</span>
                        <Input
                          type="number"
                          min={0}
                          aria-label={`Tally for ${nameById[id] || `Dish ${id}`}`}
                          value={counts[String(id)] ?? ""}
                          onChange={(e) =>
                            setCounts((c) => ({ ...c, [String(id)]: e.target.value }))
                          }
                          className="w-28"
                        />
                      </div>
                    ))}
                  </div>
                  {groupError ? (
                    <p role="alert" className="mt-2 text-sm text-destructive">
                      {groupError}
                    </p>
                  ) : (
                    <p className="mt-2 text-xs text-muted-foreground">
                      {total} of {guarantee ?? "—"} ✓
                    </p>
                  )}
                </div>
              );
            })}

            {error && (
              <p role="alert" className="text-sm text-destructive">
                {error}
              </p>
            )}

            <div className="flex gap-2">
              <Button type="button" onClick={save} disabled={blocked || saving}>
                {saving ? "Saving..." : "Save final numbers"}
              </Button>
              <Button type="button" variant="ghost" onClick={() => setOpen(false)}>
                Cancel
              </Button>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
