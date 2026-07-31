"use client";

import { ChoiceOption } from "@/lib/api";

/** The two standard-day controls on a Timeline Step row in Settings.
 *
 * These are what make the preset list the org's own template: tick a step to
 * have "+ Build a run-of-show" seed it, and say how far from meal service it
 * lands. Everything else about the row (label, order, active) is the shared
 * choice-option editor.
 */
export default function TimelineStepExtras({
  option,
  patch,
}: {
  option: ChoiceOption;
  patch: (data: Partial<ChoiceOption>) => void;
}) {
  const inDay = !!option.in_standard_day;
  const offset = option.standard_day_offset_minutes ?? 0;

  return (
    <>
      <label className="w-20 flex justify-center" title="Seed this step when a booking builds its default run-of-show">
        <input
          type="checkbox"
          aria-label={`Include ${option.label} in the standard day`}
          checked={inDay}
          onChange={(e) =>
            patch({
              in_standard_day: e.target.checked,
              // A step joining the standard day needs somewhere to land; default
              // it to meal service rather than saving an unplaceable row.
              ...(e.target.checked && option.standard_day_offset_minutes == null
                ? { standard_day_offset_minutes: 0 }
                : {}),
            })
          }
          className="h-4 w-4"
        />
      </label>
      <select
        aria-label={`${option.label} offset from meal service`}
        title="Where this step lands relative to meal service"
        value={String(offset)}
        disabled={!inDay}
        onChange={(e) => patch({ standard_day_offset_minutes: Number(e.target.value) })}
        className="w-24 h-8 rounded border border-input bg-transparent px-1 text-xs disabled:opacity-40"
      >
        {offsetChoices(offset).map((minutes) => (
          <option key={minutes} value={minutes}>{offsetLabel(minutes)}</option>
        ))}
      </select>
    </>
  );
}

/** Every 15 minutes within 6h either side of the meal — finer than that is noise
 * for a default, and a caterer retimes the row on the booking itself anyway. */
const OFFSET_CHOICES: number[] = (() => {
  const out: number[] = [];
  for (let m = -360; m <= 360; m += 15) out.push(m);
  return out;
})();

/** The grid, plus the row's own offset when it isn't on it.
 *
 * The API takes any integer, so a value can sit off the 15-minute grid (an
 * earlier default did, at -100). Without this the select finds no matching
 * option, silently displays the FIRST one, and saves that wrong value the moment
 * anything else on the row is touched. Same guard TimeField gives an off-slot
 * time.
 */
function offsetChoices(current: number): number[] {
  if (OFFSET_CHOICES.includes(current)) return OFFSET_CHOICES;
  return [...OFFSET_CHOICES, current].sort((a, b) => a - b);
}

/** -150 → "2h30 before", 0 → "at meal", 90 → "1h30 after". */
export function offsetLabel(minutes: number): string {
  if (minutes === 0) return "at meal";
  const abs = Math.abs(minutes);
  const h = Math.floor(abs / 60);
  const m = abs % 60;
  const span = h && m ? `${h}h${String(m).padStart(2, "0")}` : h ? `${h}h` : `${m}m`;
  return `${span} ${minutes < 0 ? "before" : "after"}`;
}
