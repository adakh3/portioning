"use client";

import { ValidatedInput } from "@/components/ui/validated-input";

export interface BookingTimelineValue {
  setup_time: string;         // "YYYY-MM-DDTHH:mm" (datetime-local) or ""
  guest_arrival_time: string;
  meal_time: string;
  end_time: string;
}

/** The booking timeline: setup / guest-arrival / meal / end times. Controlled;
 * shared by the quote and event editors. */
export default function BookingTimelineField({
  value,
  onChange,
  disabled = false,
}: {
  value: BookingTimelineValue;
  onChange: (patch: Partial<BookingTimelineValue>) => void;
  disabled?: boolean;
}) {
  const field = (key: keyof BookingTimelineValue, label: string) => (
    <div>
      <label className="block text-sm font-medium text-foreground mb-1">{label}</label>
      <ValidatedInput
        type="datetime-local"
        value={value[key]}
        disabled={disabled}
        onChange={(e) => onChange({ [key]: e.target.value })}
      />
    </div>
  );
  return (
    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
      {field("setup_time", "Setup Time")}
      {field("guest_arrival_time", "Guest Arrival Time")}
      {field("meal_time", "Meal Time")}
      {field("end_time", "End Time")}
    </div>
  );
}
