"use client";

import { formatDateTime as sharedFormatDateTime, formatTime } from "@/lib/dateFormat";
import type { TimelineEntry } from "@/lib/api";

/** One label/value row, matching the read-only rows elsewhere on the booking pages. */
function InfoRow({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div>
      <dt className="text-sm font-medium text-muted-foreground">{label}</dt>
      <dd className="text-sm text-foreground mt-0.5">{value || "—"}</dd>
    </div>
  );
}

/**
 * A booking's run-of-show, read-only — shared by the quote and event pages (REL-447).
 *
 * The event page has rendered this since REL-418; the quote page never did, so a
 * saved quote showed nothing at all while `bookings/pdf.py` printed the whole day on
 * the customer's PDF. A caterer couldn't check on screen what they'd just sent.
 * Extracted rather than copied so the two pages can't drift again.
 *
 * Three fallbacks, in order:
 *   1. the booking's own timeline entries;
 *   2. the four legacy time slots, but ONLY on a booking that actually has them —
 *      they're how old bookings stored their times, not an empty shape every new
 *      booking should carry;
 *   3. "No timeline set."
 */
export default function BookingTimelineView({
  entries,
  meals = [],
  eventDate,
  setupTime,
  guestArrivalTime,
  mealTime,
  endTime,
  dateFormat,
  timeFormat,
}: {
  entries: TimelineEntry[] | null | undefined;
  /** The booking's additional meals, from `timelineMealRows`. */
  meals?: { label: string; time: string }[];
  eventDate?: string | null;
  setupTime: string | null;
  guestArrivalTime: string | null;
  mealTime: string | null;
  endTime: string | null;
  dateFormat: string;
  timeFormat: "12h" | "24h";
}) {
  const rows = entries || [];
  if (rows.length > 0) {
    // Additional meals merge in at their own times — the editor does it
    // (BookingTimelineField) and so does every PDF (backend booking_timeline), so a
    // read-only view without them would lose rows on save and find them again in
    // the customer's document. Meals are merged ONLY here, in the entries branch:
    // the backend deliberately leaves them out of the legacy branch so an existing
    // booking's rendered timeline never changes underneath it.
    const merged: { key: string; time: string; date: string | null; label: string }[] = [
      ...rows.map((e) => ({ key: `e${e.id}`, time: e.time.slice(0, 5), date: e.date, label: e.label })),
      ...meals.map((m, i) => ({ key: `m${i}`, time: m.time, date: null, label: m.label })),
    ];
    // Re-sort only once meals are in the mix — without them the caterer's own
    // sort_order IS the order, and re-sorting would override a row they dragged.
    if (meals.length > 0) {
      const day = (r: { date: string | null }) => r.date || eventDate || "";
      merged.sort((a, b) => (day(a) + a.time).localeCompare(day(b) + b.time));
    }
    return (
      <dl className="space-y-1">
        {merged.map((r) => (
          <InfoRow key={r.key} label={formatTime(r.time, timeFormat)} value={r.label} />
        ))}
      </dl>
    );
  }

  const legacy = setupTime || guestArrivalTime || mealTime || endTime;
  if (!legacy) return <p className="text-sm text-muted-foreground">No timeline set.</p>;

  const fmt = (dt: string | null) => (dt ? sharedFormatDateTime(dt, dateFormat, timeFormat) : "—");
  return (
    <dl className="grid grid-cols-1 md:grid-cols-2 gap-4">
      <InfoRow label="Setup Time" value={fmt(setupTime)} />
      <InfoRow label="Guest Arrival" value={fmt(guestArrivalTime)} />
      <InfoRow label="Meal Time" value={fmt(mealTime)} />
      <InfoRow label="End Time" value={fmt(endTime)} />
    </dl>
  );
}
