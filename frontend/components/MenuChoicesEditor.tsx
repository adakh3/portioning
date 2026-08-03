"use client";

import { CourseData, MenuChoices } from "@/lib/api";
import { useDishes } from "@/lib/hooks";
import { groupChoicesByCourse } from "@/lib/finals";
import { Card, CardContent } from "@/components/ui/card";

/** "Menu choices" (REL-419) — which dishes the guest gets to pick between on a plated
 * booking. A proposal-time decision: every offering costs the same per head whoever
 * picks it, so there is no count field here and nothing is ever validated. The guest
 * numbers arrive weeks later with the final guarantee, in the event's finals panel.
 *
 * Choices belong to a COURSE — the entrée is the usual one, but a plated dinner can
 * just as well offer a choice of dessert — so the ticks are grouped by course, which
 * is also the unit the finals sum is checked against. */
export default function MenuChoicesEditor({
  courses,
  dishCourses,
  menuChoices,
  onChange,
  selectedDishIds,
  editing,
}: {
  courses: CourseData[];
  dishCourses: Record<string, number>;
  menuChoices: MenuChoices;
  onChange: (v: MenuChoices) => void;
  selectedDishIds: number[];
  editing: boolean;
}) {
  const { data: dishes = [] } = useDishes();
  const nameById: Record<number, string> = Object.fromEntries(dishes.map((d) => [d.id, d.name]));
  const assignable = selectedDishIds.filter((id) => nameById[id] !== undefined);

  const toggle = (dishId: number, offered: boolean) => {
    const next = { ...menuChoices };
    // Keep any tally already recorded against the dish; un-offering drops the row
    // entirely, which is what clears the flag and its count on save.
    if (offered) next[dishId] = next[dishId] ?? null;
    else delete next[dishId];
    onChange(next);
  };

  // The dishes to list, grouped the same way the finals panel will group them:
  // each course that has dishes, then anything left unassigned.
  const rows: { courseName: string | null; dishIds: number[] }[] = [];
  courses.forEach((course, i) => {
    const dishIds = assignable.filter((id) => dishCourses[String(id)] === i);
    if (dishIds.length) rows.push({ courseName: course.name || `Course ${i + 1}`, dishIds });
  });
  const unassigned = assignable.filter((id) => {
    const idx = dishCourses[String(id)];
    return idx === undefined || courses[idx] === undefined;
  });
  if (unassigned.length) rows.push({ courseName: null, dishIds: unassigned });

  const chosen = groupChoicesByCourse(menuChoices, courses, dishCourses);
  const offeredCount = chosen.reduce((n, g) => n + g.dishIds.length, 0);

  return (
    <Card>
      <CardContent className="p-6" data-testid="menu-choices">
        <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide mb-3">
          Menu choices
        </h2>

        <p className="text-sm text-muted-foreground mb-1">
          On a plated dinner the guest picks from what you offer. Tick the dishes
          you&apos;re offering as a choice — each costs the same per head whoever picks it.
        </p>
        <p className="text-sm text-muted-foreground mb-4">
          Anything you tick here needs its guest numbers at finals.
        </p>

        {assignable.length === 0 ? (
          <p className="text-sm text-muted-foreground">Add dishes to the menu first.</p>
        ) : !editing && offeredCount === 0 ? (
          <p className="text-sm text-muted-foreground">No choices offered.</p>
        ) : (
          <div className="space-y-4">
            {rows.map((group, gi) => {
              const visible = editing
                ? group.dishIds
                : group.dishIds.filter((id) => menuChoices[id] !== undefined);
              if (visible.length === 0) return null;
              const tickedHere = group.dishIds.filter((id) => menuChoices[id] !== undefined);
              return (
                <div key={gi}>
                  <div className="flex items-baseline justify-between border-b border-border pb-1 mb-1.5">
                    <span className="text-xs font-semibold uppercase tracking-wide text-foreground">
                      {group.courseName || "Dishes"}
                    </span>
                    {editing && group.courseName && (
                      <span className="text-xs text-muted-foreground">Offered</span>
                    )}
                  </div>
                  {visible.map((id) => (
                    <div key={id} className="flex items-center justify-between py-0.5">
                      <span className="text-sm">{nameById[id]}</span>
                      {/* Only a dish inside a course is offerable: a choice group has
                          to belong to a course to have something to sum against at
                          finals, so un-coursed dishes get no tick at all. */}
                      {editing && group.courseName ? (
                        <input
                          type="checkbox"
                          aria-label={`Offer ${nameById[id]} as a choice`}
                          checked={menuChoices[id] !== undefined}
                          onChange={(e) => toggle(id, e.target.checked)}
                          className="h-4 w-4 rounded border-input"
                        />
                      ) : !editing ? (
                        <span className="text-xs text-muted-foreground">offered</span>
                      ) : null}
                    </div>
                  ))}
                  {editing && !group.courseName && (
                    <p className="mt-1 text-xs text-muted-foreground">
                      Assign these to a course first — a choice belongs to a course.
                    </p>
                  )}
                  {editing && group.courseName && tickedHere.length === 1 && (
                    <p className="mt-1 text-xs text-muted-foreground">
                      A choice needs at least two options.
                    </p>
                  )}
                </div>
              );
            })}
          </div>
        )}

        {editing && courses.length === 0 && assignable.length > 0 && (
          <p className="mt-3 text-xs text-muted-foreground">
            Add courses to group these (Starter / Entrée / Dessert).
          </p>
        )}

        {offeredCount > 0 && (
          <p className="mt-4 border-t border-border pt-3 text-xs text-muted-foreground">
            → You&apos;ll enter how many guests picked each one in “Final numbers”, once the
            booking is confirmed.
          </p>
        )}
      </CardContent>
    </Card>
  );
}
