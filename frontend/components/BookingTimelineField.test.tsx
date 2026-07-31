import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";

import BookingTimelineField, { BookingTimelineValue, TimelineEntryValue } from "./BookingTimelineField";

const base: BookingTimelineValue = { setup_time: "", guest_arrival_time: "", meal_time: "", end_time: "" };

// ── The legacy four slots: unchanged behaviour (REL-418 AC3) ──
describe("BookingTimelineField — legacy slots", () => {
  it("renders the four timeline fields", () => {
    render(<BookingTimelineField value={base} onChange={() => {}} eventDate="2026-08-01" />);
    for (const label of ["Setup Time", "Guest Arrival", "Meal Time", "End Time"]) {
      expect(screen.getByText(label)).toBeInTheDocument();
    }
  });

  it("anchors a chosen slot to the event date", () => {
    const onChange = vi.fn();
    render(<BookingTimelineField value={base} onChange={onChange} eventDate="2026-08-01" />);
    fireEvent.change(screen.getByLabelText("Meal Time"), { target: { value: "20:00" } });
    expect(onChange).toHaveBeenLastCalledWith({ meal_time: "2026-08-01T20:00" });
  });

  it("shows the stored time in the dropdown", () => {
    render(<BookingTimelineField value={{ ...base, setup_time: "2026-08-01T10:30" }} onChange={() => {}} eventDate="2026-08-01" />);
    expect(screen.getByLabelText("Setup Time")).toHaveValue("10:30");
  });

  it("clears the field via the — Not set — option", () => {
    const onChange = vi.fn();
    render(<BookingTimelineField value={{ ...base, setup_time: "2026-08-01T10:30" }} onChange={onChange} eventDate="2026-08-01" />);
    fireEvent.change(screen.getByLabelText("Setup Time"), { target: { value: "" } });
    expect(onChange).toHaveBeenCalledWith({ setup_time: "" });
  });

  it("stays enabled without an event date and anchors the time to today", () => {
    const onChange = vi.fn();
    render(<BookingTimelineField value={base} onChange={onChange} />);
    const setup = screen.getByLabelText("Setup Time");
    expect(setup).not.toBeDisabled();
    fireEvent.change(setup, { target: { value: "20:00" } });
    expect(onChange).toHaveBeenLastCalledWith({ setup_time: expect.stringMatching(/^\d{4}-\d{2}-\d{2}T20:00$/) });
  });

  it("empty fields show — Not set —; a stored field shows its value", () => {
    const { rerender } = render(<BookingTimelineField value={base} onChange={() => {}} eventDate="2026-08-01" />);
    expect(screen.getByLabelText("Setup Time")).toHaveValue("");
    rerender(<BookingTimelineField value={{ ...base, setup_time: "2026-08-01T09:30" }} onChange={() => {}} eventDate="2026-08-01" />);
    expect(screen.getByLabelText("Setup Time")).toHaveValue("09:30");
  });

  it("shows the legacy slots only when there are no entries", () => {
    const { rerender } = render(
      <BookingTimelineField value={base} onChange={() => {}} entries={[]} onEntriesChange={() => {}} />,
    );
    expect(screen.getByText("Setup Time")).toBeInTheDocument();

    // AC4 — one entry and the four slots are replaced, not shown alongside.
    rerender(
      <BookingTimelineField value={base} onChange={() => {}}
        entries={[{ time: "18:30", label: "Dinner" }]} onEntriesChange={() => {}} />,
    );
    expect(screen.queryByText("Setup Time")).not.toBeInTheDocument();
    expect(screen.getByLabelText("Step 1 label")).toBeInTheDocument();
  });

  it("is read-only about entries when no onEntriesChange is given", () => {
    render(<BookingTimelineField value={base} onChange={() => {}} />);
    expect(screen.queryByText("+ Build a run-of-show")).not.toBeInTheDocument();
  });
});

// ── The run-of-show editor (AC1, AC2) ──
const presets = [
  { value: "cocktail_hour", label: "Cocktail hour", in_standard_day: true, standard_day_offset_minutes: -75 },
  { value: "cake_cutting", label: "Cake cutting", in_standard_day: true, standard_day_offset_minutes: 150 },
];

// An org's Timeline Steps as the API serves them: the label vocabulary AND the
// standard-day template. Mirrors TIMELINE_PRESET_DEFAULTS in
// backend/bookings/defaults.py (deliberately listed here out of clock order, to
// prove the prefill sorts by offset rather than by list position).
const fullPresets = [
  { value: "staff_arrival", label: "Staff arrive", in_standard_day: true, standard_day_offset_minutes: -210 },
  { value: "cake_cutting", label: "Cake cutting", in_standard_day: true, standard_day_offset_minutes: 150 },
  { value: "setup", label: "Setup", in_standard_day: true, standard_day_offset_minutes: -150 },
  { value: "guest_arrival", label: "Guests arrive", in_standard_day: true, standard_day_offset_minutes: -90 },
  { value: "cocktail_hour", label: "Cocktail hour", in_standard_day: true, standard_day_offset_minutes: -75 },
  { value: "dinner_service", label: "Dinner service", in_standard_day: true, standard_day_offset_minutes: 0 },
  { value: "speeches", label: "Speeches / toasts", in_standard_day: true, standard_day_offset_minutes: 90 },
  { value: "last_call", label: "Last call", in_standard_day: true, standard_day_offset_minutes: 240 },
  { value: "breakdown", label: "Breakdown", in_standard_day: true, standard_day_offset_minutes: 270 },
  // In the dropdown, but the org left it out of the standard day.
  { value: "dancing", label: "Dancing", in_standard_day: false, standard_day_offset_minutes: 180 },
];

function renderEntries(entries: TimelineEntryValue[], onEntriesChange = vi.fn()) {
  render(
    <BookingTimelineField value={base} onChange={() => {}} entries={entries}
      onEntriesChange={onEntriesChange} presets={presets} eventDate="2026-08-01" />,
  );
  return onEntriesChange;
}

describe("BookingTimelineField — run-of-show entries", () => {
  it("lays out a standard day on the first click, timed off the meal time", () => {
    // The whole point of the prefill: one click gives the shape of the day, and
    // the caterer deletes what doesn't apply.
    const onEntriesChange = vi.fn();
    render(
      <BookingTimelineField value={{ ...base, meal_time: "2026-08-01T18:30" }}
        onChange={() => {}} entries={[]} onEntriesChange={onEntriesChange}
        presets={fullPresets} eventDate="2026-08-01" />,
    );
    fireEvent.click(screen.getByText("+ Build a run-of-show"));
    // In clock order, from the org's offsets — not the order the presets arrived
    // in, and without the step the org left out of the standard day.
    expect(onEntriesChange).toHaveBeenCalledWith([
      { time: "15:00", label: "Staff arrive" },
      { time: "16:00", label: "Setup" },
      { time: "17:00", label: "Guests arrive" },
      { time: "17:15", label: "Cocktail hour" },
      { time: "18:30", label: "Dinner service" },
      { time: "20:00", label: "Speeches / toasts" },
      { time: "21:00", label: "Cake cutting" },
      { time: "22:30", label: "Last call" },
      { time: "23:00", label: "Breakdown" },
    ]);
  });

  it("seeds only the steps the org ticked into its standard day", () => {
    const onEntriesChange = vi.fn();
    render(
      <BookingTimelineField value={{ ...base, meal_time: "2026-08-01T18:30" }}
        onChange={() => {}} entries={[]} onEntriesChange={onEntriesChange}
        presets={fullPresets} eventDate="2026-08-01" />,
    );
    fireEvent.click(screen.getByText("+ Build a run-of-show"));
    const seeded = onEntriesChange.mock.calls[0][0] as { label: string }[];
    // "Dancing" is a valid label in the dropdown but is not in the standard day.
    expect(seeded.map((r) => r.label)).not.toContain("Dancing");
  });

  it("follows the org's retimed offset rather than any built-in default", () => {
    // A lunch caterer compresses the day: setup 45 minutes before, not 2h30.
    const onEntriesChange = vi.fn();
    render(
      <BookingTimelineField value={{ ...base, meal_time: "2026-08-01T12:00" }}
        onChange={() => {}} entries={[]} onEntriesChange={onEntriesChange}
        presets={[
          { value: "setup", label: "Setup", in_standard_day: true, standard_day_offset_minutes: -45 },
          { value: "dinner_service", label: "Lunch service", in_standard_day: true, standard_day_offset_minutes: 0 },
        ]} eventDate="2026-08-01" />,
    );
    fireEvent.click(screen.getByText("+ Build a run-of-show"));
    expect(onEntriesChange).toHaveBeenCalledWith([
      { time: "11:15", label: "Setup" },
      { time: "12:00", label: "Lunch service" },
    ]);
  });

  it("seeds a step the org invented, once it's in the standard day", () => {
    const onEntriesChange = vi.fn();
    render(
      <BookingTimelineField value={{ ...base, meal_time: "2026-08-01T18:30" }}
        onChange={() => {}} entries={[]} onEntriesChange={onEntriesChange}
        presets={[
          { value: "dinner_service", label: "Dinner service", in_standard_day: true, standard_day_offset_minutes: 0 },
          { value: "sparkler_send_off", label: "Sparkler send-off", in_standard_day: true, standard_day_offset_minutes: 300 },
        ]} eventDate="2026-08-01" />,
    );
    fireEvent.click(screen.getByText("+ Build a run-of-show"));
    expect(onEntriesChange).toHaveBeenCalledWith([
      { time: "18:30", label: "Dinner service" },
      { time: "23:30", label: "Sparkler send-off" },
    ]);
  });

  it("ignores a step ticked into the day but given no offset", () => {
    const onEntriesChange = vi.fn();
    render(
      <BookingTimelineField value={base} onChange={() => {}} entries={[]}
        onEntriesChange={onEntriesChange}
        presets={[{ value: "setup", label: "Setup", in_standard_day: true, standard_day_offset_minutes: null }]} />,
    );
    fireEvent.click(screen.getByText("+ Build a run-of-show"));
    // Unplaceable, so nothing to seed — falls back to a blank row.
    expect(onEntriesChange).toHaveBeenCalledWith([{ time: "18:30", label: "" }]);
  });

  it("anchors on 18:30 when the booking has no meal time", () => {
    const onEntriesChange = vi.fn();
    render(
      <BookingTimelineField value={base} onChange={() => {}} entries={[]}
        onEntriesChange={onEntriesChange} presets={fullPresets} />,
    );
    fireEvent.click(screen.getByText("+ Build a run-of-show"));
    const seeded = onEntriesChange.mock.calls[0][0] as { time: string; label: string }[];
    expect(seeded.find((r) => r.label === "Dinner service")!.time).toBe("18:30");
  });

  it("never overwrites a legacy time the booking already has", () => {
    // Setup was explicitly set to 14:00 — the computed -2h30 offset must not win.
    // (End Time maps to "Last call" — the event being over — not Breakdown.)
    const onEntriesChange = vi.fn();
    render(
      <BookingTimelineField
        value={{ ...base, meal_time: "2026-08-01T18:30", setup_time: "2026-08-01T14:00" }}
        onChange={() => {}} entries={[]} onEntriesChange={onEntriesChange}
        presets={fullPresets} eventDate="2026-08-01" />,
    );
    fireEvent.click(screen.getByText("+ Build a run-of-show"));
    const seeded = onEntriesChange.mock.calls[0][0] as { time: string; label: string }[];
    expect(seeded.find((r) => r.label === "Setup")!.time).toBe("14:00");
  });

  it("only seeds steps the org still has, under the org's own wording", () => {
    // An org that deleted "Cake cutting" and renamed "Dinner service" gets
    // neither the deleted row back nor someone else's wording.
    const onEntriesChange = vi.fn();
    render(
      <BookingTimelineField value={{ ...base, meal_time: "2026-08-01T18:30" }}
        onChange={() => {}} entries={[]} onEntriesChange={onEntriesChange}
        presets={[
          { value: "setup", label: "Load in", in_standard_day: true, standard_day_offset_minutes: -150 },
          { value: "dinner_service", label: "Mains out", in_standard_day: true, standard_day_offset_minutes: 0 },
        ]} eventDate="2026-08-01" />,
    );
    fireEvent.click(screen.getByText("+ Build a run-of-show"));
    expect(onEntriesChange).toHaveBeenCalledWith([
      { time: "16:00", label: "Load in" },
      { time: "18:30", label: "Mains out" },
    ]);
  });

  it("stays in clock order even when the legacy times disagree with the offsets", () => {
    // A real existing booking, from dev: Setup 18:00 but Meal 08:00 — the four
    // legacy columns were never validated against each other, so plenty of them
    // are incoherent. Sorting by OFFSET and then substituting the legacy time
    // produced a run-of-show that jumped 04:30 → 18:00 → 07:30. Order has to be
    // decided on the final times.
    const onEntriesChange = vi.fn();
    render(
      <BookingTimelineField
        value={{
          setup_time: "2026-12-23T18:00",
          guest_arrival_time: "2026-12-23T07:30",
          meal_time: "2026-12-23T08:00",
          end_time: "2026-12-23T10:00",
        }}
        onChange={() => {}} entries={[]} onEntriesChange={onEntriesChange}
        presets={fullPresets} eventDate="2026-12-23" />,
    );
    fireEvent.click(screen.getByText("+ Build a run-of-show"));
    const times = (onEntriesChange.mock.calls[0][0] as { time: string }[]).map((r) => r.time);
    expect(times).toEqual([...times].sort());
  });

  it("carries an existing End Time onto Last call, not Breakdown", () => {
    const onEntriesChange = vi.fn();
    render(
      <BookingTimelineField
        value={{ ...base, meal_time: "2026-08-01T18:30", end_time: "2026-08-01T23:00" }}
        onChange={() => {}} entries={[]} onEntriesChange={onEntriesChange}
        presets={fullPresets} eventDate="2026-08-01" />,
    );
    fireEvent.click(screen.getByText("+ Build a run-of-show"));
    const seeded = onEntriesChange.mock.calls[0][0] as { time: string; label: string }[];
    expect(seeded.find((r) => r.label === "Last call")!.time).toBe("23:00");
    // Breakdown keeps its own computed offset — the crew packs down afterwards.
    expect(seeded.find((r) => r.label === "Breakdown")!.time).toBe("23:00");
  });

  it("falls back to one blank row for an org with no presets yet", () => {
    // An org that predates presets and hasn't run seed_org_choices. The button
    // must still do something visible rather than appear broken.
    const onEntriesChange = vi.fn();
    render(
      <BookingTimelineField value={base} onChange={() => {}} entries={[]}
        onEntriesChange={onEntriesChange} presets={[]} />,
    );
    fireEvent.click(screen.getByText("+ Build a run-of-show"));
    expect(onEntriesChange).toHaveBeenCalledWith([{ time: "18:30", label: "" }]);
  });

  it("clamps a seeded day inside the event date rather than wrapping past midnight", () => {
    const onEntriesChange = vi.fn();
    render(
      <BookingTimelineField value={{ ...base, meal_time: "2026-08-01T22:00" }}
        onChange={() => {}} entries={[]} onEntriesChange={onEntriesChange}
        presets={fullPresets} eventDate="2026-08-01" />,
    );
    fireEvent.click(screen.getByText("+ Build a run-of-show"));
    const seeded = onEntriesChange.mock.calls[0][0] as { time: string; label: string }[];
    // Breakdown would be 02:30 the next day; it clamps to the end of the day.
    expect(seeded.find((r) => r.label === "Breakdown")!.time).toBe("23:59");
  });

  it("appends a step an hour after the last one", () => {
    const onEntriesChange = renderEntries([{ time: "18:30", label: "Dinner" }]);
    fireEvent.click(screen.getByText("+ Add step"));
    expect(onEntriesChange).toHaveBeenCalledWith([
      { time: "18:30", label: "Dinner" },
      { time: "19:30", label: "" },
    ]);
  });

  it("offers the org's presets as a closed dropdown", () => {
    renderEntries([{ time: "17:00", label: "" }]);
    const select = screen.getByLabelText("Step 1 label");
    expect(select.tagName).toBe("SELECT");
    const options = Array.from(select.querySelectorAll("option")).map((o) => o.getAttribute("value"));
    // The unchosen placeholder, then exactly the org's presets — no free text.
    expect(options).toEqual(["", "Cocktail hour", "Cake cutting"]);
  });

  it("picks a preset label", () => {
    const onEntriesChange = renderEntries([{ time: "17:00", label: "" }]);
    fireEvent.change(screen.getByLabelText("Step 1 label"), { target: { value: "Cocktail hour" } });
    expect(onEntriesChange).toHaveBeenLastCalledWith([{ time: "17:00", label: "Cocktail hour" }]);
  });

  it("keeps a label whose preset was since renamed or deleted", () => {
    // Otherwise a saved booking would silently snap to whatever option the
    // browser picks first, rewriting history on the next save.
    renderEntries([{ time: "17:00", label: "Ice sculpture reveal" }]);
    const select = screen.getByLabelText("Step 1 label") as HTMLSelectElement;
    expect(select.value).toBe("Ice sculpture reveal");
    const options = Array.from(select.querySelectorAll("option")).map((o) => o.getAttribute("value"));
    expect(options).toEqual(["", "Ice sculpture reveal", "Cocktail hour", "Cake cutting"]);
  });

  it("edits a step's time", () => {
    const onEntriesChange = renderEntries([{ time: "17:00", label: "Cocktails" }]);
    fireEvent.change(screen.getByLabelText("Step 1 time"), { target: { value: "17:30" } });
    expect(onEntriesChange).toHaveBeenLastCalledWith([{ time: "17:30", label: "Cocktails" }]);
  });

  it("reorders steps (AC2)", () => {
    const rows = [
      { time: "17:00", label: "Cocktails" },
      { time: "18:30", label: "Dinner" },
    ];
    const onEntriesChange = renderEntries(rows);
    fireEvent.click(screen.getByLabelText("Move step 2 up"));
    expect(onEntriesChange).toHaveBeenLastCalledWith([
      { time: "18:30", label: "Dinner" },
      { time: "17:00", label: "Cocktails" },
    ]);
  });

  it("removes a step (AC2)", () => {
    const onEntriesChange = renderEntries([
      { time: "17:00", label: "Cocktails" },
      { time: "18:30", label: "Dinner" },
    ]);
    fireEvent.click(screen.getByLabelText("Remove step 1"));
    expect(onEntriesChange).toHaveBeenLastCalledWith([{ time: "18:30", label: "Dinner" }]);
  });

  it("can't move the first step up or the last step down", () => {
    renderEntries([
      { time: "17:00", label: "Cocktails" },
      { time: "18:30", label: "Dinner" },
    ]);
    expect(screen.getByLabelText("Move step 1 up")).toBeDisabled();
    expect(screen.getByLabelText("Move step 2 down")).toBeDisabled();
  });

  it("offers no '— Not set —' on a step's time", () => {
    // Regression: an empty time drops the row from the save payload, and the
    // backend's delete-all+recreate then destroys it — silently losing the
    // label the user typed. Removing a step is the ✕ button's job.
    renderEntries([{ time: "17:00", label: "Cocktails" }]);
    const options = Array.from(screen.getByLabelText("Step 1 time").querySelectorAll("option"));
    expect(options.some((o) => o.getAttribute("value") === "")).toBe(false);
    // …while the legacy slots keep it — those are genuinely optional.
    expect(screen.queryByText("— Not set —")).not.toBeInTheDocument();
  });

  it("legacy slots still offer '— Not set —'", () => {
    render(<BookingTimelineField value={base} onChange={() => {}} entries={[]} onEntriesChange={vi.fn()} />);
    const options = Array.from(screen.getByLabelText("Setup Time").querySelectorAll("option"));
    expect(options.some((o) => o.getAttribute("value") === "")).toBe(true);
  });

  it("a step added but not yet chosen is still a valid row", () => {
    // The backend accepts a blank label (a timed "—" is a real run-of-show row),
    // so the editor must not block or drop it either.
    const onEntriesChange = renderEntries([{ time: "17:00", label: "" }]);
    expect((screen.getByLabelText("Step 1 label") as HTMLSelectElement).value).toBe("");
    fireEvent.change(screen.getByLabelText("Step 1 time"), { target: { value: "17:30" } });
    expect(onEntriesChange).toHaveBeenLastCalledWith([{ time: "17:30", label: "" }]);
  });

  it("never bumps a new step past the end of the day", () => {
    const onEntriesChange = renderEntries([{ time: "23:30", label: "Last call" }]);
    fireEvent.click(screen.getByText("+ Add step"));
    expect(onEntriesChange).toHaveBeenCalledWith([
      { time: "23:30", label: "Last call" },
      { time: "23:30", label: "" },
    ]);
  });

  it("labels times in the org's 12h preference while storing 24h", () => {
    const onEntriesChange = vi.fn();
    render(
      <BookingTimelineField value={base} onChange={() => {}} timeFormat="12h"
        entries={[{ time: "18:30", label: "Dinner" }]} onEntriesChange={onEntriesChange} />,
    );
    const select = screen.getByLabelText("Step 1 time");
    expect(select).toHaveValue("18:30");                       // stored 24h
    expect(screen.getByText("6:30 PM")).toBeInTheDocument();   // shown 12h
  });
});
