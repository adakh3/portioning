"use client";

import { CourseData, EntreeChoices } from "@/lib/api";
import { useDishes } from "@/lib/hooks";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";

/** Courses (Starter/Entrée/Dessert) and the dish→course assignment for a booking
 * (REL-417). Courses are grouping only — service style is booking-level, not
 * per-course. Shared by the quote and event editors. Controlled: the page holds
 * `courses` + `dishCourses` ({dishId -> course index}) and this component keeps the
 * index references consistent when courses are reordered or removed.
 *
 * On a PLATED booking it also marks which dishes are offered as an entrée choice
 * (REL-419) — a proposal-time decision, priced per head whoever picks what. The
 * tallies are not entered here and nothing is validated: those arrive weeks later
 * with the final guarantee, in the event's "Record final numbers" panel. */
export default function CoursesEditor({
  courses,
  dishCourses,
  entreeChoices,
  plated = false,
  onChange,
  selectedDishIds,
  editing,
}: {
  courses: CourseData[];
  dishCourses: Record<string, number>;
  entreeChoices?: EntreeChoices;
  /** Booking-level service style is plated — only then are entrée choices offered. */
  plated?: boolean;
  onChange: (v: {
    courses: CourseData[];
    dishCourses: Record<string, number>;
    entreeChoices: EntreeChoices;
  }) => void;
  selectedDishIds: number[];
  editing: boolean;
}) {
  const { data: dishes = [] } = useDishes();
  const nameById: Record<number, string> = Object.fromEntries(dishes.map((d) => [d.id, d.name]));
  const choices: EntreeChoices = entreeChoices || {};

  // Always emit courses with sort_order == array position (0..n-1).
  const emit = (
    nextCourses: CourseData[],
    nextDishCourses: Record<string, number>,
    nextChoices: EntreeChoices = choices,
  ) =>
    onChange({
      courses: nextCourses.map((c, i) => ({ ...c, sort_order: i })),
      dishCourses: nextDishCourses,
      entreeChoices: nextChoices,
    });

  const toggleChoice = (dishId: number, offered: boolean) => {
    const next = { ...choices };
    // Keep any tally already recorded against the dish; un-offering drops the row
    // entirely, which is what clears the flag and its count on save.
    if (offered) next[dishId] = next[dishId] ?? null;
    else delete next[dishId];
    emit(courses, dishCourses, next);
  };

  const addCourse = () =>
    emit([...courses, { name: "", sort_order: courses.length }], dishCourses);

  const patchCourse = (idx: number, fields: Partial<CourseData>) =>
    emit(courses.map((c, i) => (i === idx ? { ...c, ...fields } : c)), dishCourses);

  const move = (idx: number, dir: -1 | 1) => {
    const j = idx + dir;
    if (j < 0 || j >= courses.length) return;
    const next = courses.slice();
    [next[idx], next[j]] = [next[j], next[idx]];
    // Swap the two indices anywhere they're referenced so assignments follow the move.
    const remapped = Object.fromEntries(
      Object.entries(dishCourses).map(([d, i]) => [d, i === idx ? j : i === j ? idx : i]),
    );
    emit(next, remapped);
  };

  const removeCourse = (idx: number) => {
    const next = courses.filter((_, i) => i !== idx);
    const remapped: Record<string, number> = {};
    for (const [d, i] of Object.entries(dishCourses)) {
      if (i === idx) continue; // dishes on the removed course become unassigned
      remapped[d] = i > idx ? i - 1 : i;
    }
    emit(next, remapped);
  };

  const assign = (dishId: number, value: string) => {
    const next = { ...dishCourses };
    if (value === "") delete next[dishId];
    else next[dishId] = Number(value);
    emit(courses, next);
  };

  const assignableDishes = selectedDishIds.filter((id) => nameById[id] !== undefined);

  return (
    <Card>
      <CardContent className="p-6">
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide">Courses</h2>
          {editing && (
            <Button type="button" variant="outline" size="sm" onClick={addCourse}>+ Add course</Button>
          )}
        </div>

        {courses.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            No courses{editing ? " — add courses to group the menu (Starter / Entrée / Dessert)." : "."}
          </p>
        ) : (
          <div className="space-y-2">
            {courses.map((c, idx) =>
              editing ? (
                <div key={idx} className="flex items-center gap-2">
                  <input
                    type="text"
                    aria-label={`Course ${idx + 1} name`}
                    placeholder="Course name"
                    value={c.name}
                    onChange={(e) => patchCourse(idx, { name: e.target.value })}
                    className="flex h-9 rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring flex-1"
                  />
                  <Button type="button" variant="ghost" size="sm" aria-label={`Move course ${idx + 1} up`} disabled={idx === 0} onClick={() => move(idx, -1)}>↑</Button>
                  <Button type="button" variant="ghost" size="sm" aria-label={`Move course ${idx + 1} down`} disabled={idx === courses.length - 1} onClick={() => move(idx, 1)}>↓</Button>
                  <Button type="button" variant="ghost" size="sm" className="text-destructive" onClick={() => removeCourse(idx)}>Remove</Button>
                </div>
              ) : (
                <div key={idx} className="text-sm">
                  <span className="font-medium">{c.name || "Untitled course"}</span>
                  {(() => {
                    const dishesHere = assignableDishes.filter((id) => dishCourses[id] === idx);
                    return dishesHere.length > 0 ? (
                      <span className="text-muted-foreground">
                        : {dishesHere.map((id) => `${nameById[id]}${choices[id] !== undefined ? " (choice)" : ""}`).join(", ")}
                      </span>
                    ) : null;
                  })()}
                </div>
              ),
            )}
          </div>
        )}

        {/* Choices with no courses still need a read-only home — otherwise marking
            them and saving would look like nothing happened. */}
        {!editing && courses.length === 0 && assignableDishes.some((id) => choices[id] !== undefined) && (
          <p className="mt-2 text-sm">
            <span className="font-medium">Entrée choices: </span>
            <span className="text-muted-foreground">
              {assignableDishes.filter((id) => choices[id] !== undefined).map((id) => nameById[id]).join(", ")}
            </span>
          </p>
        )}

        {/* Per-dish row: the course picker, and on a plated booking the
            "offered as a choice" flag. Shown as soon as EITHER has something to
            offer, so choices can be marked before any course exists. */}
        {editing && assignableDishes.length > 0 && (courses.length > 0 || plated) && (
          <div className="mt-4 border-t border-border pt-3">
            <label className="block text-sm font-medium text-foreground mb-2">
              {courses.length > 0 ? "Assign dishes" : "Dishes"}
            </label>
            <div className="space-y-1.5">
              {assignableDishes.map((id) => (
                <div key={id} className="flex items-center gap-2">
                  <span className="text-sm flex-1">{nameById[id]}</span>
                  {plated && (
                    <label className="flex items-center gap-1.5 text-xs text-muted-foreground whitespace-nowrap">
                      <input
                        type="checkbox"
                        aria-label={`Offer ${nameById[id]} as a choice`}
                        checked={choices[id] !== undefined}
                        onChange={(e) => toggleChoice(id, e.target.checked)}
                        className="h-4 w-4 rounded border-input"
                      />
                      Offered as a choice
                    </label>
                  )}
                  {courses.length > 0 && (
                    <select
                      aria-label={`Course for ${nameById[id]}`}
                      value={dishCourses[id] ?? ""}
                      onChange={(e) => assign(id, e.target.value)}
                      className="flex h-9 rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                    >
                      <option value="">Unassigned</option>
                      {courses.map((c, i) => (
                        <option key={i} value={i}>{c.name || `Course ${i + 1}`}</option>
                      ))}
                    </select>
                  )}
                </div>
              ))}
            </div>
            {plated && (
              <p className="mt-2 text-xs text-muted-foreground">
                Entrée choices are priced per head whoever picks what. The tallies arrive
                with the final guarantee — record them on the event, not here.
              </p>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
