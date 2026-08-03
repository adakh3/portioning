import type { CourseData, MenuChoices } from "@/lib/api";

/** The menu as one structure: courses containing dishes, with the guest-choice
 * marked inside the course (REL-451). Pure helpers so the card's JSX stays readable
 * and every rule here is unit-testable.
 *
 * The data model is unchanged — `courses` (ordered), `dishCourses` ({dishId -> course
 * index}) and `menuChoices` ({dishId -> tally|null}) are exactly what the API already
 * sends and the save payload already carries. */

export type MenuSection = {
  /** Index into `courses`, or null for the trailing unassigned section. */
  courseIndex: number | null;
  /** Course name; null for the unassigned section (rendered as "On the table"). */
  name: string | null;
  /** Dish ids in render order — offered choices first, then every-plate dishes. */
  dishIds: number[];
  /** The offered subset, in order. Always empty when the booking isn't plated. */
  chosenIds: number[];
};

/**
 * Whether this service style lets the caterer offer the guest a choice.
 *
 * Plated is the only style where each guest is committed to an *individual*
 * portion, so the split has to be known before the day. Every other seeded style
 * either lets the guest pick at the point of service (buffet, stations, passed)
 * or shares platters (family style), and drop-off has no service at all.
 *
 * This DELIBERATELY MIRRORS the backend: `PLATED_SERVICE_STYLE` / `is_plated_service`
 * in `backend/events/models.py`, which `choice_groups()` uses to decide what the
 * contract renders. The card must not offer a flag the API will ignore — a choice
 * marked on a buffet would save onto the row and then render nowhere.
 *
 * It is a slug check on an org-editable list, which is its known weakness: a style
 * added as "Plated (duet)" gets no choice affordances. The durable fix is a
 * per-style flag on `ServiceStyleOption` (data, not code); it needs a backend change
 * this frontend-only ticket doesn't carry, so both pages route through here to keep
 * that swap a one-liner on this side.
 */
export const isPlated = (serviceStyle: string | null | undefined) => serviceStyle === "plated";

const isOffered = (choices: MenuChoices, dishId: number) =>
  choices[dishId] !== undefined;

/**
 * Split the booking's dishes into course sections plus a trailing unassigned one.
 *
 * `dishIds` is the booking's menu in add order, which is the order every document
 * renders in — sections preserve it, except that offered dishes sort to the top of
 * their course so the *or* pair can never be visually separated (AC5).
 *
 * A section is only "choice-bearing" on a plated booking: on buffet or family style
 * the guest picks at the line or the table, so the flags are kept but never shown
 * (AC8) — the same rule the backend applies when it renders the contract.
 */
export function menuSections(
  dishIds: number[],
  courses: CourseData[],
  dishCourses: Record<string, number>,
  menuChoices: MenuChoices,
  plated: boolean,
): MenuSection[] {
  const sections: MenuSection[] = [];
  const courseOf = (id: number) => {
    const idx = dishCourses[String(id)];
    return idx === undefined || courses[idx] === undefined ? null : idx;
  };

  const build = (courseIndex: number | null, name: string | null): MenuSection => {
    const mine = dishIds.filter((id) => courseOf(id) === courseIndex);
    // A choice belongs to a course: an unassigned dish is never an option, however
    // its flag got there (REL-419 left the flag clearable only inside a course).
    const chosenIds =
      plated && courseIndex !== null ? mine.filter((id) => isOffered(menuChoices, id)) : [];
    const rest = mine.filter((id) => !chosenIds.includes(id));
    return { courseIndex, name, dishIds: [...chosenIds, ...rest], chosenIds };
  };

  courses.forEach((course, i) => sections.push(build(i, course.name || `Course ${i + 1}`)));
  const unassigned = build(null, null);
  if (unassigned.dishIds.length > 0) sections.push(unassigned);
  return sections;
}

/**
 * The line under a course title. Owner call (2026-08-03): the informational subtitles
 * ("guests choose 1 of 2, with 2 sides", "3 dishes") are gone — the *or* between the
 * options already says what the course does, and a dish count is noise next to a list
 * you can see.
 *
 * What survives is the one state you can't read off the rows: a course with exactly
 * ONE option, which looks like a choice but serves every guest the same thing (AC7).
 * It is a warning, never a blocker, and it disappears the moment a second option is
 * marked. `null` means render nothing.
 */
export function courseWarning(section: MenuSection): string | null {
  return section.chosenIds.length === 1 ? "a choice needs two options" : null;
}

/**
 * Move one dish up or down through the flattened running order, hopping into the
 * neighbouring course when it steps past a section's end (AC2) — the keyboard and
 * touch path for the same thing dragging does.
 *
 * Returns the next `dishCourses` and `menuChoices`. Landing in a different course
 * clears the dish's choice flag: nothing arrives pre-marked as an option in a course
 * whose choice the caterer hasn't declared.
 */
export function moveDish(
  dishId: number,
  direction: -1 | 1,
  sections: MenuSection[],
  dishCourses: Record<string, number>,
  menuChoices: MenuChoices,
): { dishCourses: Record<string, number>; menuChoices: MenuChoices } {
  const from = sections.findIndex((s) => s.dishIds.includes(dishId));
  if (from === -1) return { dishCourses, menuChoices };
  const section = sections[from];
  const at = section.dishIds.indexOf(dishId);
  const steppingOut =
    (direction === -1 && at === 0) || (direction === 1 && at === section.dishIds.length - 1);
  if (!steppingOut) return { dishCourses, menuChoices };  // reorder within a course is drag's job

  const target = sections[from + direction];
  if (!target) return { dishCourses, menuChoices };

  const nextCourses = { ...dishCourses };
  if (target.courseIndex === null) delete nextCourses[dishId];
  else nextCourses[dishId] = target.courseIndex;

  return { dishCourses: nextCourses, menuChoices: clearChoice(menuChoices, dishId) };
}

/** Drop the dish's offered flag — used whenever it lands in a different course. */
export function clearChoice(menuChoices: MenuChoices, dishId: number): MenuChoices {
  if (menuChoices[dishId] === undefined) return menuChoices;
  const next = { ...menuChoices };
  delete next[dishId];
  return next;
}

/** Assign a dish to a course (or to the unassigned section with `null`), clearing
 * its choice flag when the course actually changes. */
export function assignDish(
  dishId: number,
  courseIndex: number | null,
  dishCourses: Record<string, number>,
  menuChoices: MenuChoices,
): { dishCourses: Record<string, number>; menuChoices: MenuChoices } {
  const current = dishCourses[String(dishId)];
  const unchanged = courseIndex === null ? current === undefined : current === courseIndex;
  const nextCourses = { ...dishCourses };
  if (courseIndex === null) delete nextCourses[dishId];
  else nextCourses[dishId] = courseIndex;
  return {
    dishCourses: nextCourses,
    menuChoices: unchanged ? menuChoices : clearChoice(menuChoices, dishId),
  };
}

/** Toggle whether a dish is one of its course's options. */
export function toggleChoice(menuChoices: MenuChoices, dishId: number): MenuChoices {
  if (menuChoices[dishId] !== undefined) return clearChoice(menuChoices, dishId);
  // Keep any tally the finals panel already recorded against the dish.
  return { ...menuChoices, [dishId]: menuChoices[dishId] ?? null };
}

/** Remove a course, dropping its dishes into the unassigned section rather than a
 * neighbouring course (deliberate deviation from the prototype: `course=None` is a
 * real state the documents already render as "Additional dishes"). Indices above the
 * removed one shift down to stay in step with the `courses` array. */
export function removeCourse(
  courseIndex: number,
  courses: CourseData[],
  dishCourses: Record<string, number>,
  menuChoices: MenuChoices,
): {
  courses: CourseData[];
  dishCourses: Record<string, number>;
  menuChoices: MenuChoices;
} {
  const nextCourses = courses
    .filter((_, i) => i !== courseIndex)
    .map((c, i) => ({ ...c, sort_order: i }));
  const nextDishCourses: Record<string, number> = {};
  let nextChoices = menuChoices;
  for (const [dish, idx] of Object.entries(dishCourses)) {
    if (idx === courseIndex) {
      nextChoices = clearChoice(nextChoices, Number(dish));  // no course, no choice
      continue;
    }
    nextDishCourses[dish] = idx > courseIndex ? idx - 1 : idx;
  }
  return { courses: nextCourses, dishCourses: nextDishCourses, menuChoices: nextChoices };
}
