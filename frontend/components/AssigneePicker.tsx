"use client";

import { Avatar } from "@/components/ui/avatar";
import { Select, SelectContent, SelectItem, SelectTrigger } from "@/components/ui/select";

interface Person { id: number; first_name: string; last_name: string }

const NONE = "__none__";
const fullName = (u: Person) => `${u.first_name} ${u.last_name}`.trim();

/** Labelled "Assigned" control: a custom dropdown showing the owner's initials
 * avatar INSIDE the control (and beside every option). Shared by the quote and
 * event headers so they stay identical. */
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
  const name = matched ? fullName(matched) : (currentName || "");
  return (
    <div className="flex flex-col gap-1">
      <label className="text-xs font-medium text-muted-foreground">Assigned</label>
      <Select
        value={value != null ? String(value) : NONE}
        onValueChange={(v) => {
          // Radix can emit "" transiently before options mount; treat any
          // non-positive/invalid id as "unassigned" rather than pk 0.
          const next = v === NONE ? null : Number(v);
          onChange(Number.isInteger(next) && (next as number) > 0 ? next : null);
        }}
        disabled={disabled}
      >
        <SelectTrigger aria-label="Assigned salesperson" className="min-w-[11rem] gap-2">
          {/* div (not span) so the trigger's [&>span]:line-clamp-1 rule can't turn
              this into a -webkit-box and squash the circular avatar. */}
          <div className="flex min-w-0 items-center gap-2">
            <Avatar name={name} size="sm" />
            <span className="truncate">{name || "Unassigned"}</span>
          </div>
        </SelectTrigger>
        <SelectContent>
          <SelectItem value={NONE}>
            <span className="flex items-center gap-2"><Avatar name="" size="sm" />Unassigned</span>
          </SelectItem>
          {options.map((u) => (
            <SelectItem key={u.id} value={String(u.id)}>
              <span className="flex items-center gap-2"><Avatar name={fullName(u)} size="sm" />{fullName(u)}</span>
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}
