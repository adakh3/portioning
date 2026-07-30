"use client";

import { CourseData } from "@/lib/api";
import { useDishes } from "@/lib/hooks";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";

/** Courses (Starter/Entrée/Dessert + service style) and the dish→course assignment
 * for a booking (REL-417). Shared by the quote and event editors. Controlled: the
 * page holds `courses` + `dishCourses` ({dishId -> course index}) and this component
 * keeps the index references consistent when courses are reordered or removed. */
export default function CoursesEditor({
  courses,
  dishCourses,
  onChange,
  selectedDishIds,
  serviceStyles,
  editing,
}: {
  courses: CourseData[];
  dishCourses: Record<string, number>;
  onChange: (v: { courses: CourseData[]; dishCourses: Record<string, number> }) => void;
  selectedDishIds: number[];
  serviceStyles: { value: string; label: string }[];
  editing: boolean;
}) {
  const { data: dishes = [] } = useDishes();
  const nameById: Record<number, string> = Object.fromEntries(dishes.map((d) => [d.id, d.name]));
  const styleLabel = (value: string) => serviceStyles.find((s) => s.value === value)?.label || value;

  // Always emit courses with sort_order == array position (0..n-1).
  const emit = (nextCourses: CourseData[], nextDishCourses: Record<string, number>) =>
    onChange({
      courses: nextCourses.map((c, i) => ({ ...c, sort_order: i })),
      dishCourses: nextDishCourses,
    });

  const addCourse = () =>
    emit([...courses, { name: "", service_style: "", sort_order: courses.length }], dishCourses);

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
                  <select
                    aria-label={`Course ${idx + 1} service style`}
                    value={c.service_style}
                    onChange={(e) => patchCourse(idx, { service_style: e.target.value })}
                    className="flex h-9 rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                  >
                    <option value="">Service style…</option>
                    {serviceStyles.map((st) => (
                      <option key={st.value} value={st.value}>{st.label}</option>
                    ))}
                  </select>
                  <Button type="button" variant="ghost" size="sm" aria-label={`Move course ${idx + 1} up`} disabled={idx === 0} onClick={() => move(idx, -1)}>↑</Button>
                  <Button type="button" variant="ghost" size="sm" aria-label={`Move course ${idx + 1} down`} disabled={idx === courses.length - 1} onClick={() => move(idx, 1)}>↓</Button>
                  <Button type="button" variant="ghost" size="sm" className="text-destructive" onClick={() => removeCourse(idx)}>Remove</Button>
                </div>
              ) : (
                <div key={idx} className="text-sm">
                  <span className="font-medium">{c.name || "Untitled course"}</span>
                  {c.service_style && <span className="text-muted-foreground"> — {styleLabel(c.service_style)}</span>}
                  {(() => {
                    const dishesHere = assignableDishes.filter((id) => dishCourses[id] === idx);
                    return dishesHere.length > 0 ? (
                      <span className="text-muted-foreground">: {dishesHere.map((id) => nameById[id]).join(", ")}</span>
                    ) : null;
                  })()}
                </div>
              ),
            )}
          </div>
        )}

        {editing && courses.length > 0 && assignableDishes.length > 0 && (
          <div className="mt-4 border-t border-border pt-3">
            <label className="block text-sm font-medium text-foreground mb-2">Assign dishes</label>
            <div className="space-y-1.5">
              {assignableDishes.map((id) => (
                <div key={id} className="flex items-center gap-2">
                  <span className="text-sm flex-1">{nameById[id]}</span>
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
                </div>
              ))}
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
