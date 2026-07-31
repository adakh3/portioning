"use client";

import {
  DndContext, closestCenter, PointerSensor, useSensor, useSensors, type DragEndEvent,
} from "@dnd-kit/core";
import {
  SortableContext, verticalListSortingStrategy, useSortable, arrayMove,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
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

/** An org's timeline step: the only labels a booking may use, and — via the last
 * two fields — the org's own standard-day template. */
export interface TimelinePreset {
  value: string;
  label: string;
  in_standard_day?: boolean;
  standard_day_offset_minutes?: number | null;
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
  presets?: TimelinePreset[];
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

  // Drag to reorder, the same @dnd-kit pattern Settings uses for choice options.
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 5 } }));

  // …and plain arrow keys on the handle, so reordering works without a mouse.
  // Deliberately our own handler rather than dnd-kit's KeyboardSensor: this is
  // one predictable line of behaviour instead of a second sensor competing with
  // the pointer one, and it's the only version that can be tested anywhere but a
  // real browser.
  const moveRow = (index: number, delta: number) => {
    const to = index + delta;
    if (to < 0 || to >= rows.length) return;
    onEntriesChange?.(arrayMove(rows, index, to));
  };

  const handleDragEnd = (e: DragEndEvent) => {
    const { active, over } = e;
    if (!over || active.id === over.id) return;
    const from = Number(active.id) - 1;
    const to = Number(over.id) - 1;
    if (from < 0 || to < 0) return;
    onEntriesChange?.(arrayMove(rows, from, to));
  };

  // A new step lands after the last one, an hour on from it — the common case is
  // "and then, a bit later, …", so the caterer adjusts rather than types from scratch.
  const addRow = () => {
    const last = rows[rows.length - 1];
    const nextTime = last ? bumpHour(last.time) : DEFAULT_ANCHOR;
    onEntriesChange?.([...rows, { time: nextTime, label: "" }]);
  };

  /** First click: lay out the org's standard day rather than one empty row.
   *
   * An event day is predictable, so starting from the whole shape and deleting
   * what doesn't apply beats building it step by step. The shape is the org's
   * OWN — every step it ticked in Settings → Timeline Steps, at the offset it
   * chose from meal service — so adding, removing or retiming a default step is
   * ordinary Settings work rather than something only we can change.
   *
   * Times hang off the booking's meal time, and any of the four legacy slots the
   * booking already has win over the computed offset: we never overwrite a time
   * the user gave us. Rows come out in clock order, because a run-of-show that
   * didn't would be wrong whatever the Settings order says.
   *
   * With nothing configured (an org that predates presets and hasn't run
   * `seed_org_choices`) it falls back to one blank row — the button must never
   * look broken.
   */
  const startRunOfShow = () => {
    const anchor = timePart(value.meal_time) || DEFAULT_ANCHOR;

    const seeded = presets
      .filter((p) => p.in_standard_day && p.standard_day_offset_minutes != null)
      .map((p) => {
        const legacyField = LEGACY_SLOT_BY_SLUG[p.value];
        const legacy = legacyField ? timePart(value[legacyField]) : "";
        return {
          time: legacy || shiftTime(anchor, p.standard_day_offset_minutes!),
          label: p.label,
        };
      })
      // Sorted on the FINAL time, not the offset. An inherited legacy time can
      // contradict its step's offset — the four legacy columns were never
      // validated against each other, so real bookings have e.g. Setup 18:00
      // with Meal 08:00 — and ordering by offset would then emit a run-of-show
      // that jumps backwards. "HH:MM" sorts chronologically as a string.
      .sort((a, b) => a.time.localeCompare(b.time));

    onEntriesChange?.(seeded.length ? seeded : [{ time: anchor, label: "" }]);
  };

  // The four legacy slots are how OLD bookings stored their times — not a mode to
  // choose. They appear only on a booking that actually has one set, where they
  // are also the thing "+ Build a run-of-show" converts from. A booking without
  // them never sees them.
  const hasLegacyTimes = LEGACY_ONLY_FIELDS.some((key) => !!value[key]);

  if (rows.length === 0 && hasLegacyTimes) {
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
              Carries these times into a full day built from your Timeline Steps,
              and replaces the four slots above.
            </p>
          </div>
        )}
      </div>
    );
  }

  if (rows.length === 0) {
    if (!editable) {
      return <p className="text-sm text-muted-foreground">No timeline set.</p>;
    }
    return (
      <div className="space-y-2">
        {/* Meal time is the anchor the whole day hangs off, so it's asked for
            here rather than left as one of four look-alike slots. It still
            writes the same `meal_time` column. */}
        <div className="flex flex-wrap items-end gap-3">
          <div className="w-36">{field("meal_time", "Meal Time")}</div>
          <Button type="button" size="sm" variant="outline" disabled={disabled} onClick={startRunOfShow}>
            + Build a run-of-show
          </Button>
          <Button type="button" size="sm" variant="ghost" disabled={disabled} onClick={addRow}>
            + Add step
          </Button>
        </div>
        <p className="text-xs text-muted-foreground">
          Builds a standard day from your Timeline Steps around the meal time —
          delete what doesn&apos;t apply. Or add steps one at a time.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-2">
      <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
        <SortableContext items={rows.map((_, i) => i + 1)} strategy={verticalListSortingStrategy}>
          {rows.map((row, i) => (
            <StepRow
              key={row.id ?? `new-${i}`}
              index={i}
              row={row}
              presets={presets}
              disabled={disabled}
              timeFormat={timeFormat}
              onPatch={(patch) => patchRow(i, patch)}
              onRemove={() => removeRow(i)}
              onMove={(delta) => moveRow(i, delta)}
            />
          ))}
        </SortableContext>
      </DndContext>

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

/** The legacy columns that mark a booking as one that stored its day the OLD way.
 *
 * `meal_time` is deliberately NOT in this list. It is the anchor a NEW booking
 * writes through the picker in the empty state, so treating it as a legacy
 * marker made the other three slots spring into view the instant you set a meal
 * time — which is exactly the confusion this whole change removes.
 */
const LEGACY_ONLY_FIELDS: (keyof BookingTimelineValue)[] = [
  "setup_time", "guest_arrival_time", "end_time",
];

/** Which legacy column a seeded step inherits its time from, by preset slug.
 *
 * Stays hardcoded on purpose: the four legacy columns are a fact of the schema,
 * not org configuration, and these four slugs are the canonical steps they mean.
 * `end_time` maps to "Last call" — the event being over — rather than Breakdown,
 * which is the crew packing down afterwards. An org that renamed or deleted one
 * of these presets simply doesn't get the inheritance for it.
 */
const LEGACY_SLOT_BY_SLUG: Record<string, keyof BookingTimelineValue | undefined> = {
  setup: "setup_time",
  guest_arrival: "guest_arrival_time",
  dinner_service: "meal_time",
  last_call: "end_time",
};

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

/** One draggable row of the run-of-show: when it happens, and what happens. */
function StepRow({
  index, row, presets, disabled, timeFormat, onPatch, onRemove, onMove,
}: {
  index: number;
  row: TimelineEntryValue;
  presets: TimelinePreset[];
  disabled: boolean;
  timeFormat: "12h" | "24h";
  onPatch: (patch: Partial<TimelineEntryValue>) => void;
  onRemove: () => void;
  onMove: (delta: number) => void;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } =
    useSortable({ id: index + 1 });
  const style = { transform: CSS.Transform.toString(transform), transition, opacity: isDragging ? 0.6 : 1 };
  const n = index + 1;

  return (
    <div ref={setNodeRef} style={style} className="flex items-center gap-2">
      <button type="button" disabled={disabled}
        aria-label={`Reorder step ${n} — drag, or use the arrow keys`}
        title="Drag to reorder, or focus and use the arrow keys"
        {...attributes} {...listeners}
        onKeyDown={(e) => {
          if (e.key !== "ArrowUp" && e.key !== "ArrowDown") return;
          e.preventDefault();
          onMove(e.key === "ArrowUp" ? -1 : 1);
        }}
        className="cursor-grab active:cursor-grabbing text-muted-foreground hover:text-foreground touch-none px-1">
        <svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor" aria-hidden="true">
          <circle cx="5" cy="3" r="1.4" /><circle cx="11" cy="3" r="1.4" />
          <circle cx="5" cy="8" r="1.4" /><circle cx="11" cy="8" r="1.4" />
          <circle cx="5" cy="13" r="1.4" /><circle cx="11" cy="13" r="1.4" />
        </svg>
      </button>
      <div className="w-32 shrink-0">
        {/* No "— Not set —" here: a step with no time is dropped on save, which
            would silently delete the row and its label. Removing a step is what
            the ✕ is for. */}
        <TimeField
          ariaLabel={`Step ${n} time`}
          value={row.time}
          disabled={disabled}
          format={timeFormat}
          allowEmpty={false}
          onChange={(t) => onPatch({ time: t })}
        />
      </div>
      {/* A closed list, not free text: the org's Timeline Steps are the only
          labels a row may take, which keeps them consistent across bookings. New
          wording goes in Settings, once, for everyone. */}
      <select
        aria-label={`Step ${n} label`}
        value={row.label}
        disabled={disabled}
        onChange={(e) => onPatch({ label: e.target.value })}
        className="flex h-9 w-full rounded-md border border-input bg-transparent px-2 py-1 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:opacity-50"
      >
        <option value="">— Choose a step —</option>
        {labelOptions(presets, row.label).map((label) => (
          <option key={label} value={label}>{label}</option>
        ))}
      </select>
      <Button type="button" size="sm" variant="ghost" aria-label={`Remove step ${n}`}
        disabled={disabled} onClick={onRemove}>
        ✕
      </Button>
    </div>
  );
}
