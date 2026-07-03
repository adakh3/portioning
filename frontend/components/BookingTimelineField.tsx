"use client";

import TimeField from "@/components/TimeField";
import { todayISO } from "@/lib/dateFormat";

export interface BookingTimelineValue {
  setup_time: string;         // "YYYY-MM-DDTHH:mm" (stored) or ""
  guest_arrival_time: string;
  meal_time: string;
  end_time: string;
}

/** The booking timeline: setup / guest-arrival / meal / end. Entered as plain
 * times (HH:MM) and anchored to the booking's event date — the model stores a
 * full datetime, but the user only picks a time. Controlled; shared by the quote
 * and event editors. */
export default function BookingTimelineField({
  value,
  onChange,
  eventDate,
  disabled = false,
}: {
  value: BookingTimelineValue;
  onChange: (patch: Partial<BookingTimelineValue>) => void;
  /** The booking's event date ("YYYY-MM-DD"); entered times are anchored to it. */
  eventDate?: string;
  disabled?: boolean;
}) {
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
        onChange={(t) => setTime(key, t)}
      />
    </div>
  );

  return (
    <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
      {field("setup_time", "Setup Time")}
      {field("guest_arrival_time", "Guest Arrival")}
      {field("meal_time", "Meal Time")}
      {field("end_time", "End Time")}
    </div>
  );
}
