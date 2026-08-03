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

export type CourseSubtitle = { text: string; warn: boolean };

/**
 * The live line under a course title. Two offered dishes read as the choice the
 * caterer is declaring ("guests choose 1 of 2, with 2 sides"); exactly one reads as
 * a warning, because a choice of one is 150 guests all served the same thing (AC7).
 * Save is never blocked on it.
 */
export function courseSubtitle(section: MenuSection): CourseSubtitle {
  const total = section.dishIds.length;
  const chosen = section.chosenIds.length;
  const count = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

  if (chosen === 1) return { text: "a choice needs two options", warn: true };
  if (chosen >= 2) {
    const sides = total - chosen;
    const base = `guests choose 1 of ${chosen}`;
    const suffix = sides > 0 ? `, with ${count(sides, "side", "sides")}` : "";
    return { text: `${base}${suffix}`, warn: false };
  }
  return { text: count(total, "dish", "dishes"), warn: false };
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
