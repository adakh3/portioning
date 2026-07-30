"use client";

import TimeField from "@/components/TimeField";
import { Button } from "@/components/ui/button";
import { todayISO } from "@/lib/dateFormat";

export interface BookingTimelineValue {
  setup_time: string;         // "YYYY-MM-DDTHH:mm" (stored) or ""
  guest_arrival_time: string;
  meal_time: string;
  end_time: string;
}

/** One moment in the run-of-show. `time` is 24h "HH:MM" — the same shape the
 * backend's TimeField stores. */
export interface TimelineEntryValue {
  id?: number;
  time: string;
  label: string;
}

/** The booking timeline, in one of two modes.
 *
 * With NO entries the booking shows the four legacy slots (setup / guest-arrival
 * / meal / end) exactly as it always has — that is what every existing booking
 * sees, and nothing migrates them. Add a step and the booking switches to its own
 * ordered run-of-show; the legacy fields stay on the record but stop rendering.
 *
 * Times use the shared `TimeField` dropdown, deliberately NOT a native
 * `<input type="time">`: Safari doesn't reliably fire onChange on it, which is
 * the exact bug class that once let "the timeline doesn't save" ship green.
 *
 * Controlled; shared by the quote and event editors. */
export default function BookingTimelineField({
  value,
  onChange,
  entries,
  onEntriesChange,
  presets = [],
  eventDate,
  disabled = false,
  timeFormat = "24h",
}: {
  value: BookingTimelineValue;
  onChange: (patch: Partial<BookingTimelineValue>) => void;
  /** The booking's own run-of-show. Empty ⇒ the legacy slots render instead. */
  entries?: TimelineEntryValue[];
  onEntriesChange?: (entries: TimelineEntryValue[]) => void;
  /** Org timeline-step presets offered in the label picker. */
  presets?: { value: string; label: string }[];
  /** The booking's event date ("YYYY-MM-DD"); entered legacy times are anchored to it. */
  eventDate?: string;
  disabled?: boolean;
  /** Org time-entry preference ("12h"/"24h"). */
  timeFormat?: "12h" | "24h";
}) {
  const rows = entries ?? [];
  const editable = !!onEntriesChange;

  const timePart = (dt: string) => (dt && dt.includes("T") ? dt.slice(11, 16) : "");

  const setTime = (key: keyof BookingTimelineValue, time: string) => {
    if (!time) {
      onChange({ [key]: "" });
      return;
    }
    // Keep the field's own date if it already has one, else anchor to the event
    // date; fall back to today so a time entered before the date isn't lost.
    const existingDate = value[key] && value[key].includes("T") ? value[key].slice(0, 10) : "";
    const date = existingDate || eventDate || todayISO();
    onChange({ [key]: `${date}T${time}` });
  };

  const field = (key: keyof BookingTimelineValue, label: string) => (
    <div>
      <label className="block text-sm font-medium text-foreground mb-1">{label}</label>
      <TimeField
        ariaLabel={label}
        value={timePart(value[key])}
        disabled={disabled}
        format={timeFormat}
        onChange={(t) => setTime(key, t)}
      />
    </div>
  );

  const patchRow = (index: number, patch: Partial<TimelineEntryValue>) =>
    onEntriesChange?.(rows.map((r, i) => (i === index ? { ...r, ...patch } : r)));

  const removeRow = (index: number) =>
    onEntriesChange?.(rows.filter((_, i) => i !== index));

  const moveRow = (index: number, delta: number) => {
    const to = index + delta;
    if (to < 0 || to >= rows.length) return;
    const next = [...rows];
    [next[index], next[to]] = [next[to], next[index]];
    onEntriesChange?.(next);
  };

  // A new step lands after the last one, an hour on from it — the common case is
  // "and then, a bit later, …", so the caterer adjusts rather than types from scratch.
  const addRow = () => {
    const last = rows[rows.length - 1];
    const nextTime = last ? bumpHour(last.time) : DEFAULT_ANCHOR;
    onEntriesChange?.([...rows, { time: nextTime, label: "" }]);
  };

  /** First click: lay out a standard catering day rather than one empty row.
   *
   * An event day is predictable, so starting from the whole shape and deleting
   * what doesn't apply beats building it step by step. Times hang off the
   * booking's own meal time, and any of the four legacy slots it already has
   * win over the computed offset — we never overwrite a time the user gave us.
   *
   * Only steps the org still has as presets are included, so an org that curated
   * its list doesn't get deleted steps back. With no presets at all (an org that
   * predates them and hasn't run `seed_org_choices`) it falls back to one blank
   * row — the button must never look broken.
   */
  const startRunOfShow = () => {
    const anchor = timePart(value.meal_time) || DEFAULT_ANCHOR;
    const bySlug = new Map(presets.map((p) => [p.value, p.label]));

    const seeded = STANDARD_DAY.flatMap((step) => {
      const label = bySlug.get(step.slug);
      if (label === undefined) return [];
      const legacy = step.legacyField ? timePart(value[step.legacyField]) : "";
      return [{ time: legacy || shiftTime(anchor, step.offsetMinutes), label }];
    });

    onEntriesChange?.(seeded.length ? seeded : [{ time: anchor, label: "" }]);
  };

  if (rows.length === 0) {
    return (
      <div className="space-y-3">
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          {field("setup_time", "Setup Time")}
          {field("guest_arrival_time", "Guest Arrival")}
          {field("meal_time", "Meal Time")}
          {field("end_time", "End Time")}
        </div>
        {editable && (
          <div>
            <Button type="button" size="sm" variant="outline" disabled={disabled} onClick={startRunOfShow}>
              + Build a run-of-show
            </Button>
            <p className="mt-1 text-xs text-muted-foreground">
              Lays out a standard day from your Timeline Steps, timed off the meal
              time — delete what doesn&apos;t apply. Replaces the four slots above.
            </p>
          </div>
        )}
      </div>
    );
  }

  return (
    <div className="space-y-2">
      {rows.map((row, i) => (
        <div key={row.id ?? `new-${i}`} className="flex items-center gap-2">
          <div className="w-32 shrink-0">
            {/* No "— Not set —" here: a step with no time is dropped on save,
                which would silently delete the row and its label. Removing a
                step is what the ✕ is for. */}
            <TimeField
              ariaLabel={`Step ${i + 1} time`}
              value={row.time}
              disabled={disabled}
              format={timeFormat}
              allowEmpty={false}
              onChange={(t) => patchRow(i, { time: t })}
            />
          </div>
          {/* A closed list, not free text: an event day is predictable enough
              that picking beats typing, and it keeps labels consistent across
              bookings (which is what makes them worth reporting on later). New
              wording goes in Settings → Timeline Steps, once, for everyone. */}
          <select
            aria-label={`Step ${i + 1} label`}
            value={row.label}
            disabled={disabled}
            onChange={(e) => patchRow(i, { label: e.target.value })}
            className="flex h-9 w-full rounded-md border border-input bg-transparent px-2 py-1 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:opacity-50"
          >
            <option value="">— Choose a step —</option>
            {labelOptions(presets, row.label).map((label) => (
              <option key={label} value={label}>{label}</option>
            ))}
          </select>
          <Button type="button" size="sm" variant="ghost" aria-label={`Move step ${i + 1} up`}
            disabled={disabled || i === 0} onClick={() => moveRow(i, -1)}>
            ↑
          </Button>
          <Button type="button" size="sm" variant="ghost" aria-label={`Move step ${i + 1} down`}
            disabled={disabled || i === rows.length - 1} onClick={() => moveRow(i, 1)}>
            ↓
          </Button>
          <Button type="button" size="sm" variant="ghost" aria-label={`Remove step ${i + 1}`}
            disabled={disabled} onClick={() => removeRow(i)}>
            ✕
          </Button>
        </div>
      ))}

      {editable && (
        <Button type="button" size="sm" variant="outline" disabled={disabled} onClick={addRow}>
          + Add step
        </Button>
      )}
    </div>
  );
}

/** Where a day hangs when the booking has no meal time of its own. */
const DEFAULT_ANCHOR = "18:30";

/** The shape of a standard catering day, as offsets in minutes from meal service.
 *
 * Keyed by preset SLUG (`TimelinePresetOption.value`), not label — so an org that
 * renamed "Dinner service" to "Mains out" still gets the row, under its own
 * wording, and an org that deleted a step doesn't get it back.
 *
 * These slugs must exist in `backend/bookings/defaults.py` TIMELINE_PRESET_DEFAULTS;
 * a test on each side pins that so the two can't drift apart.
 */
const STANDARD_DAY: {
  slug: string;
  offsetMinutes: number;
  /** A legacy slot whose time, when set, wins over the computed offset. */
  legacyField?: keyof BookingTimelineValue;
}[] = [
  { slug: "staff_arrival", offsetMinutes: -210 },
  { slug: "setup", offsetMinutes: -150, legacyField: "setup_time" },
  { slug: "guest_arrival", offsetMinutes: -90, legacyField: "guest_arrival_time" },
  { slug: "cocktail_hour", offsetMinutes: -75 },
  { slug: "dinner_service", offsetMinutes: 0, legacyField: "meal_time" },
  { slug: "speeches", offsetMinutes: 90 },
  { slug: "cake_cutting", offsetMinutes: 150 },
  { slug: "breakdown", offsetMinutes: 270, legacyField: "end_time" },
];

/** Shift "HH:MM" by minutes, clamped inside the day — a run-of-show that wrapped
 * past midnight would land on the wrong date. */
function shiftTime(time: string, minutes: number): string {
  const [h, m] = time.split(":").map((n) => parseInt(n, 10) || 0);
  const clamped = Math.max(0, Math.min(h * 60 + m + minutes, 23 * 60 + 59));
  return `${String(Math.floor(clamped / 60)).padStart(2, "0")}:${String(clamped % 60).padStart(2, "0")}`;
}

/** The labels a step may take: the org's presets, plus the row's own label when
 * that isn't one of them.
 *
 * That second part matters — a booking saved under a preset that was later
 * renamed or deleted must keep showing its label, not silently snap to the first
 * option in the list. Same guard `TimeField` applies to an off-slot time.
 */
function labelOptions(presets: { value: string; label: string }[], current: string): string[] {
  const labels = presets.map((p) => p.label);
  return current && !labels.includes(current) ? [current, ...labels] : labels;
}

/** "17:00" → "18:00", clamped to the last slot of the day so it never wraps
 * past midnight onto the wrong day. */
function bumpHour(time: string): string {
  const [h, m] = (time || "17:00").split(":");
  const minutes = (parseInt(h, 10) || 0) * 60 + (parseInt(m, 10) || 0) + 60;
  const clamped = Math.min(minutes, 23 * 60 + 30);
  const hh = Math.floor(clamped / 60);
  const mm = clamped % 60;
  return `${String(hh).padStart(2, "0")}:${String(mm).padStart(2, "0")}`;
}
