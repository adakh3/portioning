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
  /** Course name; null for the unassigned section (rendered as "Not in a course yet"). */
  name: string | null;
  /** Dish ids in render order — offered choices first, then every-plate dishes. */
  dishIds: number[];
  /** The offered subset, in order. Always empty when the booking's style doesn't offer choices. */
  chosenIds: number[];
};

/** Just enough of a service-style option to answer the question below. */
export type ServiceStyleFlag = { value: string; guests_choose?: boolean };

/**
 * Whether this service style lets the caterer offer the guest a choice.
 *
 * The answer is the ORG'S data, read off its own service-style row (REL-452). The
 * underlying property is "each guest is committed to an individual portion, so the
 * split must be known before the day" — true of a plated dinner, and of boxed
 * lunches where each person pre-picks, but not of a buffet, stations or family
 * style, where the guest picks at the line or the table.
 *
 * This DELIBERATELY MIRRORS the backend: `booking_offers_choices` in
 * `backend/events/models.py` reads the same column, and `choice_groups()` uses it to
 * decide what the contract renders. The card must not offer a flag the API will
 * ignore — a choice marked on a buffet would save onto the row and then render
 * nowhere.
 *
 * Previously a hardcoded `=== "plated"`, which excluded any style an org added
 * itself and was invisible to the admin, since slugs are generated from labels and
 * never shown. An unknown style (or a list still loading) offers nothing, which is
 * the safe direction: no affordance rather than one the backend will drop.
 */
export const guestsChoose = (
  serviceStyle: string | null | undefined,
  styles: readonly ServiceStyleFlag[],
): boolean => !!styles.find((s) => s.value === serviceStyle)?.guests_choose;

const isOffered = (choices: MenuChoices, dishId: number) =>
  choices[dishId] !== undefined;

/**
 * Split the booking's dishes into course sections plus a trailing unassigned one.
 *
 * `dishIds` is the booking's menu in add order, which is the order every document
 * renders in — sections preserve it, except that offered dishes sort to the top of
 * their course so the *or* pair can never be visually separated (AC5).
 *
 * A section is only "choice-bearing" when the style says guests choose: on buffet or
 * family style
 * the guest picks at the line or the table, so the flags are kept but never shown
 * (AC8) — the same rule the backend applies when it renders the contract.
 */
export function menuSections(
  dishIds: number[],
  courses: CourseData[],
  dishCourses: Record<string, number>,
  menuChoices: MenuChoices,
  guestsChoose: boolean,
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
      guestsChoose && courseIndex !== null ? mine.filter((id) => isOffered(menuChoices, id)) : [];
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
