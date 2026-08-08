"use client";

import { formatDate, formatTime } from "@/lib/dateFormat";
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
  meals?: { label: string; time: string; date?: string | null }[];
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
      // A meal keeps its own DAY. Dropping it put a 2am late-night snack at the top
      // of the list while the PDF correctly put it last — the screen then told the
      // caterer the snack happened before the staff arrived.
      ...meals.map((m, i) => ({ key: `m${i}`, time: m.time, date: m.date ?? null, label: m.label })),
    ];
    // Re-sort only once meals are in the mix — without them the caterer's own
    // sort_order IS the order, and re-sorting would override a row they dragged.
    if (meals.length > 0) {
      const day = (r: { date: string | null }) => r.date || eventDate || "";
      merged.sort((a, b) => (day(a) + a.time).localeCompare(day(b) + b.time));
    }
    // A row on a different day says so — "14:00 (23 Dec)" — mirroring the PDF's
    // `format_timeline_row`. Without it a load-in the afternoon before, or a 2am
    // late-night snack, reads as a bare time indistinguishable from an event-day
    // step: the caterer can't tell which day they're looking at.
    const dayLabel = (iso: string) => {
      const [y, m, d] = iso.split("-").map(Number);
      return new Date(Date.UTC(y, (m || 1) - 1, d || 1))
        .toLocaleDateString("en-GB", { day: "2-digit", month: "short", timeZone: "UTC" });
    };
    return (
      <dl className="space-y-1">
        {merged.map((r) => {
          const time = formatTime(r.time, timeFormat);
          const offDay = r.date && r.date !== eventDate ? ` (${dayLabel(r.date)})` : "";
          return <InfoRow key={r.key} label={`${time}${offDay}`} value={r.label} />;
        })}
      </dl>
    );
  }

  const legacy = setupTime || guestArrivalTime || mealTime || endTime;
  if (!legacy) return <p className="text-sm text-muted-foreground">No timeline set.</p>;

  /** A legacy slot, rendered in the time it was STORED — not the viewer's timezone.
   *
   * `formatDateTime` runs the value through `new Date()`, which converts to the
   * browser's zone. The API serves UTC (`USE_TZ=True`, `TIME_ZONE='UTC'`), so an
   * ET caterer saw a 19:30 setup as 15:30 here — while the editor on the SAME page
   * showed 19:30 (it slices the raw string) and so did the PDF the customer holds.
   * Three different answers for one field. `formatTime` already slices rather than
   * converts; the date half is pinned to local midday so no offset can roll it to
   * the previous day. */
  const fmt = (dt: string | null) => {
    if (!dt) return "—";
    const day = dt.includes("T") ? dt.slice(0, 10) : dt;
    return `${formatDate(`${day}T12:00:00`, dateFormat)}, ${formatTime(dt, timeFormat)}`;
  };
  return (
    <dl className="grid grid-cols-1 md:grid-cols-2 gap-4">
      <InfoRow label="Setup Time" value={fmt(setupTime)} />
      <InfoRow label="Guest Arrival" value={fmt(guestArrivalTime)} />
      <InfoRow label="Meal Time" value={fmt(mealTime)} />
      <InfoRow label="End Time" value={fmt(endTime)} />
    </dl>
  );
}
