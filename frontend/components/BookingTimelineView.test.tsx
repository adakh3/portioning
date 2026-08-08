import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";

import BookingTimelineView from "./BookingTimelineView";
import type { TimelineEntry } from "@/lib/api";

// REL-447 — the read-only run-of-show, shared by the quote and event pages. The
// event page has rendered this since REL-418; the quote page showed nothing at all
// while the quote PDF printed the whole day. Extracted so the two can't drift.
const entry = (over: Partial<TimelineEntry> = {}): TimelineEntry => ({
  id: 1, time: "15:00:00", label: "Staff arrive", sort_order: 0, ...over,
} as TimelineEntry);

function view(props: Partial<React.ComponentProps<typeof BookingTimelineView>> = {}) {
  return render(
    <BookingTimelineView
      entries={null}
      setupTime={null}
      guestArrivalTime={null}
      mealTime={null}
      endTime={null}
      dateFormat="DD/MM/YYYY"
      timeFormat="24h"
      {...props}
    />,
  );
}

describe("BookingTimelineView", () => {
  it("AC1: renders the booking's own entries, in the order given", () => {
    view({
      entries: [
        entry({ id: 1, time: "15:00:00", label: "Staff arrive" }),
        entry({ id: 2, time: "21:00:00", label: "Cake cutting" }),
      ],
    });

    expect(screen.getByText("Staff arrive")).toBeInTheDocument();
    expect(screen.getByText("Cake cutting")).toBeInTheDocument();
    // Times render as labels, seconds trimmed.
    expect(screen.getByText("15:00")).toBeInTheDocument();
    expect(screen.getByText("21:00")).toBeInTheDocument();
    const body = document.body.textContent ?? "";
    expect(body.indexOf("Staff arrive")).toBeLessThan(body.indexOf("Cake cutting"));
  });

  it("AC1: entries WIN over the legacy slots — they replace them, not join them", () => {
    view({
      entries: [entry({ label: "Staff arrive" })],
      setupTime: "2026-09-01T14:00:00",
      mealTime: "2026-09-01T18:30:00",
    });

    expect(screen.getByText("Staff arrive")).toBeInTheDocument();
    expect(screen.queryByText("Setup Time")).not.toBeInTheDocument();
    expect(screen.queryByText("Meal Time")).not.toBeInTheDocument();
  });

  // AC4 — the read-only view must show the same rows the editor and the PDF do.
  // The editor merges additional meals (BookingTimelineField) and so does the
  // backend `booking_timeline`, so omitting them here would mean: see a meal while
  // editing, lose it on save, find it again in the customer's PDF.
  it("AC4: additional meals merge into the run-of-show, in time order", () => {
    view({
      entries: [
        entry({ id: 1, time: "15:00:00", label: "Staff arrive" }),
        entry({ id: 2, time: "21:00:00", label: "Cake cutting" }),
      ],
      meals: [{ label: "Late-night snack", time: "19:30" }],
      eventDate: "2026-09-01",
    });

    const body = document.body.textContent ?? "";
    expect(screen.getByText("Late-night snack")).toBeInTheDocument();
    expect(body.indexOf("Staff arrive")).toBeLessThan(body.indexOf("Late-night snack"));
    expect(body.indexOf("Late-night snack")).toBeLessThan(body.indexOf("Cake cutting"));
  });

  it("AC4: with no meals, the caterer's own order is left alone — not re-sorted", () => {
    // Mirrors the backend's rule: re-sort ONLY once meals are in the mix, because
    // without them `sort_order` is the order and a caterer may have dragged a row
    // deliberately out of clock order.
    view({
      entries: [
        entry({ id: 1, time: "21:00:00", label: "Cake cutting" }),
        entry({ id: 2, time: "15:00:00", label: "Staff arrive" }),
      ],
    });

    const body = document.body.textContent ?? "";
    expect(body.indexOf("Cake cutting")).toBeLessThan(body.indexOf("Staff arrive"));
  });

  it("AC4: meals are NOT merged into the legacy-slot fallback", () => {
    // The backend excludes them there on purpose, so an existing booking's rendered
    // timeline never changes underneath it — including quotes already signed.
    view({
      entries: [],
      meals: [{ label: "Late-night snack", time: "19:30" }],
      setupTime: "2026-09-01T14:00:00",
    });

    expect(screen.getByText("Setup Time")).toBeInTheDocument();
    expect(screen.queryByText("Late-night snack")).not.toBeInTheDocument();
  });

  it("AC2: falls back to the four legacy slots when there are no entries", () => {
    view({ entries: [], setupTime: "2026-09-01T14:00:00", mealTime: "2026-09-01T18:30:00" });

    for (const label of ["Setup Time", "Guest Arrival", "Meal Time", "End Time"]) {
      expect(screen.getByText(label)).toBeInTheDocument();
    }
  });

  it("AC2: an unset legacy slot shows an em-dash, not 'null'", () => {
    view({ entries: [], setupTime: "2026-09-01T14:00:00Z" });
    // Assert the dash is actually THERE — "not NaN" alone would pass on an empty
    // string, which is the sort of assertion that looks like coverage and isn't.
    const endTimeRow = screen.getByText("End Time").parentElement;
    expect(endTimeRow?.textContent).toContain("—");
    expect(document.body.textContent ?? "").not.toMatch(/null|undefined|NaN|Invalid/);
  });

  // REL-447 review — the case the first cut got wrong, and that my own PDF-test
  // fixture had steered around by pinning the event date to the meal's day.
  it("AC6: a meal after midnight sorts LAST, as the PDF orders it — not first", () => {
    view({
      entries: [
        entry({ id: 1, time: "15:00:00", label: "Staff arrive" }),
        entry({ id: 2, time: "21:00:00", label: "Cake cutting" }),
      ],
      // 2am the following morning. Slicing this to "02:00" and forgetting the day
      // put it at the TOP — the screen claiming the snack preceded the staff.
      meals: [{ label: "Late-night snack", time: "02:00", date: "2026-09-02" }],
      eventDate: "2026-09-01",
    });

    const body = document.body.textContent ?? "";
    expect(body.indexOf("Cake cutting")).toBeLessThan(body.indexOf("Late-night snack"));
    // ...and it says which day it's on, as the PDF does.
    expect(body).toContain("02 Sep");
  });

  it("AC6: an entry on an earlier day is labelled with its day", () => {
    view({
      entries: [entry({ id: 1, time: "14:00:00", label: "Load-in", date: "2026-08-31" })],
      meals: [{ label: "Brunch", time: "11:00", date: "2026-09-01" }],
      eventDate: "2026-09-01",
    });

    const body = document.body.textContent ?? "";
    expect(body).toContain("31 Aug");
    // The load-in is the day before, so it comes first.
    expect(body.indexOf("Load-in")).toBeLessThan(body.indexOf("Brunch"));
  });

  it("event-day rows carry NO day suffix — only the ones that differ", () => {
    view({
      entries: [entry({ id: 1, time: "15:00:00", label: "Staff arrive", date: "2026-09-01" })],
      meals: [{ label: "Brunch", time: "11:00", date: "2026-09-01" }],
      eventDate: "2026-09-01",
    });
    expect(document.body.textContent ?? "").not.toContain("Sep)");
  });

  it("a legacy slot shows the time as STORED, not shifted into the viewer's zone", () => {
    // The API serves UTC. Converting via `new Date()` showed an ET caterer 15:30
    // for a 19:30 setup — disagreeing with the editor on the same page AND the PDF.
    view({ entries: [], setupTime: "2026-09-01T19:30:00Z" });
    const row = screen.getByText("Setup Time").parentElement;
    expect(row?.textContent).toContain("19:30");
  });

  it("renders 12h times when the org prefers them", () => {
    view({
      entries: [entry({ id: 1, time: "15:00:00", label: "Staff arrive" })],
      timeFormat: "12h",
    });
    expect(screen.getByText(/3:00 PM/)).toBeInTheDocument();
  });

  it("AC3: neither entries nor legacy times reads 'No timeline set.'", () => {
    view({ entries: [] });

    expect(screen.getByText("No timeline set.")).toBeInTheDocument();
    // The card must not silently vanish — that was the bug.
    expect(screen.queryByText("Setup Time")).not.toBeInTheDocument();
  });

  it("AC3: a null entries list behaves the same as an empty one", () => {
    view({ entries: null });
    expect(screen.getByText("No timeline set.")).toBeInTheDocument();
  });
});
