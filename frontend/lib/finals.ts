import type { EntreeChoices, FinalsStatus } from "@/lib/api";

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

/** The tallies' running total, for the panel's live sum check. Blank entries count
 * as zero so a half-filled panel reads as "doesn't add up yet", not as valid. */
export function entreeTallyTotal(counts: Record<string, string>): number {
  return Object.values(counts).reduce((sum, v) => sum + (parseInt(v, 10) || 0), 0);
}

/** The live validation message for the finals panel, or null when it is safe to
 * save. Mirrors the backend's check in EventFinalsSerializer — the backend stays
 * the enforcer; this is the message that stops the owner submitting a bad panel.
 *
 * Only ever called from the panel: nothing on a quote runs this (AC8).
 */
export function entreeTallyError(
  counts: Record<string, string>,
  guarantee: number | null,
): string | null {
  if (guarantee === null || Number.isNaN(guarantee)) return null;
  const total = entreeTallyTotal(counts);
  if (total === guarantee) return null;
  return `Entrée choices must add up to the final guarantee (${guarantee}) — they currently total ${total}.`;
}

/** The dish ids offered as an entrée choice, as numbers, in a stable order. */
export function offeredEntreeIds(choices: EntreeChoices | undefined): number[] {
  return Object.keys(choices || {})
    .map(Number)
    .sort((a, b) => a - b);
}
