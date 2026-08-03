import type { CourseData, FinalsStatus, MenuChoices } from "@/lib/api";

/** Presentation for the derived finals state (REL-419). The state itself is computed
 * on the backend (`finals_status`) so the event page, the events list and any future
 * surface can never disagree about whether finals are outstanding. */

export type FinalsPill = {
  /** Text before the due date; the caller appends the org-formatted date. */
  label: string;
  /** Colour token into STATUS_COLORS — amber approaching, red overdue, green done. */
  color: "amber" | "red" | "green" | "slate";
  /** Whether the pill should show the due date after its label. */
  showsDueDate: boolean;
};

const PILLS: Record<Exclude<FinalsStatus, null>, FinalsPill> = {
  awaiting: { label: "Finals due", color: "slate", showsDueDate: true },
  due_soon: { label: "Finals due", color: "amber", showsDueDate: true },
  overdue: { label: "Finals overdue", color: "red", showsDueDate: true },
  recorded: { label: "Finals recorded", color: "green", showsDueDate: false },
};

/** The pill for a finals state, or null when there is nothing to show. */
export function finalsPill(status: FinalsStatus): FinalsPill | null {
  return status ? PILLS[status] : null;
}

/** One course's worth of offered choices. `courseName` is null for dishes that
 * aren't assigned to a course — they group together and read as "Menu choices". */
export type ChoiceGroup = {
  courseName: string | null;
  dishIds: number[];
};

/** The dish ids offered as a choice, as numbers, in a stable order. */
export function offeredChoiceIds(choices: MenuChoices | undefined): number[] {
  return Object.keys(choices || {})
    .map(Number)
    .sort((a, b) => a - b);
}

/**
 * A booking's offered choices grouped BY COURSE — the mirror of `choice_groups` in
 * `backend/events/models.py`, and the reason the two can't disagree about what has
 * to add up.
 *
 * Every guest picks one dish from each course that offers a choice, so each group is
 * validated against the guarantee on its own. `dishCourses` maps dish id → index into
 * `courses` (the shape both serializers already expose); a dish with no course falls
 * into a trailing unnamed group.
 */
export function groupChoicesByCourse(
  choices: MenuChoices | undefined,
  courses: CourseData[],
  dishCourses: Record<string, number>,
): ChoiceGroup[] {
  const offered = offeredChoiceIds(choices);
  if (offered.length === 0) return [];
  const byIndex = new Map<number | null, number[]>();
  for (const id of offered) {
    const idx = dishCourses[String(id)];
    const key = idx === undefined || courses[idx] === undefined ? null : idx;
    byIndex.set(key, [...(byIndex.get(key) || []), id]);
  }
  const groups: ChoiceGroup[] = [];
  courses.forEach((course, i) => {
    const dishIds = byIndex.get(i);
    if (dishIds) groups.push({ courseName: course.name || `Course ${i + 1}`, dishIds });
  });
  const loose = byIndex.get(null);
  if (loose) groups.push({ courseName: null, dishIds: loose });
  return groups;
}

/** A group's running total. Blank entries count as zero, so a half-filled group —
 * or one left entirely untouched — reads as "doesn't add up yet", not as valid. */
export function choiceTallyTotal(
  counts: Record<string, string>,
  dishIds: number[],
): number {
  return dishIds.reduce((sum, id) => sum + (parseInt(counts[String(id)], 10) || 0), 0);
}

/**
 * The live validation message for ONE course's choices, or null when that group is
 * safe to save. Mirrors the backend's per-group check in `EventFinalsSerializer` —
 * the backend stays the enforcer; this is the message that stops the owner
 * submitting a bad panel.
 *
 * Only ever called from the finals panel: nothing on a quote runs this (AC8).
 */
export function choiceTallyError(
  counts: Record<string, string>,
  guarantee: number | null,
  group: ChoiceGroup,
): string | null {
  if (guarantee === null || Number.isNaN(guarantee)) return null;
  if (group.dishIds.some((id) => (parseInt(counts[String(id)], 10) || 0) < 0)) {
    // The backend rejects these too; catching it here keeps the group's own running
    // total from claiming a negative breakdown adds up.
    return "A tally cannot be negative.";
  }
  const total = choiceTallyTotal(counts, group.dishIds);
  if (total === guarantee) return null;
  const label = group.courseName ? `${group.courseName} choices` : "Menu choices";
  return `${label} must add up to the final guarantee (${guarantee}) — they currently total ${total}.`;
}
