"use client";

import { ChoiceOption } from "@/lib/api";

/** The "Guests pre-pick dishes" control on a Service Style row in Settings (REL-452).
 *
 * This is the one behaviour that depends on how food is served: when it's on, a
 * booking in this style can mark two dishes in a course as the guest's options,
 * and the contract reads "Choice of: A / B". The property isn't the style's name
 * but whether each guest is committed to an individual portion — true of a plated
 * dinner, and of boxed lunches where everyone pre-picks, which is why it has to be
 * the org's call rather than a name we recognise.
 *
 * The label lives ON the control (owner, 2026-08-10): the earlier cut was a bare
 * checkbox under a distant "Guests choose" column header, which answered neither
 * "choose what?" nor "which row am I ticking?".
 */
export default function ServiceStyleExtras({
  option,
  patch,
}: {
  option: ChoiceOption;
  patch: (data: Partial<ChoiceOption>) => void;
}) {
  return (
    <label
      className="flex items-center gap-1.5 whitespace-nowrap text-xs text-muted-foreground cursor-pointer"
      title="Each guest picks their dish in advance (plated dinners, pre-picked boxed lunches). Bookings in this style can offer a choice of dish per course and collect the tallies with the final numbers."
    >
      <input
        type="checkbox"
        aria-label={`Guests pre-pick dishes on ${option.label}`}
        checked={!!option.guests_choose}
        onChange={(e) => patch({ guests_choose: e.target.checked })}
        className="h-4 w-4"
      />
      Guests pre-pick dishes
    </label>
  );
}
