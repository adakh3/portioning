"use client";

import { ChoiceOption } from "@/lib/api";

/** The "Guests choose" control on a Service Style row in Settings (REL-452).
 *
 * This is the one behaviour that depends on how food is served: when it's on, a
 * booking in this style can mark two dishes in a course as the guest's options,
 * and the contract reads "Choice of: A / B". The property isn't the style's name
 * but whether each guest is committed to an individual portion — true of a plated
 * dinner, and of boxed lunches where everyone pre-picks, which is why it has to be
 * the org's call rather than a name we recognise.
 *
 * Before this, the rule was a hardcoded check for the slug `plated` — invisible
 * here, since slugs are generated from labels and never shown, so an admin could
 * neither see why one row behaved differently nor make another behave the same.
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
      className="w-28 flex justify-center"
      title="Bookings in this style can offer the guest a choice of dish"
    >
      <input
        type="checkbox"
        aria-label={`Guests choose between dishes on ${option.label}`}
        checked={!!option.guests_choose}
        onChange={(e) => patch({ guests_choose: e.target.checked })}
        className="h-4 w-4"
      />
    </label>
  );
}
