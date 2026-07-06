"use client";

import { Avatar } from "@/components/ui/avatar";

interface Person { id: number; first_name: string; last_name: string }

/** Labelled "Assigned" control: an initials avatar of the current owner + a select
 * to (re)assign. Shared by the quote and event headers so they stay identical. */
export default function AssigneePicker({
  value,
  currentName,
  options,
  onChange,
  disabled = false,
}: {
  value: number | null;
  /** Name for the avatar when the value isn't in `options` (e.g. an admin owner). */
  currentName?: string | null;
  options: Person[];
  onChange: (id: number | null) => void;
  disabled?: boolean;
}) {
  const matched = options.find((u) => u.id === value);
  const name = matched ? `${matched.first_name} ${matched.last_name}`.trim() : (currentName || "");
  return (
    <div className="flex flex-col gap-1">
      <label className="text-xs font-medium text-muted-foreground">Assigned</label>
      <div className="flex items-center gap-2">
        <Avatar name={name} />
        <select
          value={value ?? ""}
          onChange={(e) => onChange(e.target.value ? Number(e.target.value) : null)}
          disabled={disabled}
          title="Salesperson credited for this booking (drives commission)"
          aria-label="Assigned salesperson"
          className="flex h-9 rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
        >
          <option value="">Unassigned</option>
          {options.map((u) => <option key={u.id} value={u.id}>{u.first_name} {u.last_name}</option>)}
        </select>
      </div>
    </div>
  );
}
