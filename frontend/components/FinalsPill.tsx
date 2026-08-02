"use client";

import type { FinalsStatus } from "@/lib/api";
import { finalsPill } from "@/lib/finals";
import { formatDate } from "@/lib/dateFormat";
import { statusColor } from "@/lib/statusColors";
import { cn } from "@/lib/utils";

/** The derived finals reminder (REL-419): amber as the due date approaches, red once
 * it has passed, green once the numbers are in. Same component on the event page and
 * the events list, so the two can't drift. Renders nothing when there is nothing to
 * chase — an unconfirmed event, or a confirmed one with no due date set. */
export default function FinalsPill({
  status,
  dueDate,
  dateFormat,
  className,
}: {
  status: FinalsStatus;
  dueDate: string | null;
  dateFormat: string;
  className?: string;
}) {
  const pill = finalsPill(status);
  if (!pill) return null;
  const date = pill.showsDueDate && dueDate ? formatDate(dueDate, dateFormat) : "";
  return (
    <span
      data-testid="finals-pill"
      data-finals-status={status}
      className={cn(
        "inline-block rounded-full px-2.5 py-0.5 text-xs font-medium uppercase tracking-wide whitespace-nowrap",
        statusColor(pill.color).pill,
        className,
      )}
    >
      {pill.label}
      {date ? ` ${date}` : ""}
    </span>
  );
}
