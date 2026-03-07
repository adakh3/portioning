"use client";

import { useState } from "react";
import Link from "next/link";
import { api, Reminder } from "@/lib/api";
import { useReminders } from "@/lib/hooks";
import { revalidate } from "@/lib/hooks";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";

function formatDue(dateStr: string) {
  const d = new Date(dateStr);
  const now = new Date();
  const diffMs = d.getTime() - now.getTime();
  const diffMins = Math.round(diffMs / 60000);
  const diffHours = Math.round(diffMs / 3600000);

  const timeStr = d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  const dateDisplay = d.toLocaleDateString([], { month: "short", day: "numeric" });

  if (diffMins < 0) {
    const ago = Math.abs(diffMins);
    if (ago < 60) return `${ago}m ago`;
    if (ago < 1440) return `${Math.round(ago / 60)}h ago`;
    return `${dateDisplay} ${timeStr}`;
  }
  if (diffMins < 60) return `in ${diffMins}m`;
  if (diffHours < 24) return `in ${diffHours}h`;
  return `${dateDisplay} ${timeStr}`;
}

function ReminderCard({
  reminder,
  onAction,
}: {
  reminder: Reminder;
  onAction: () => void;
}) {
  const [acting, setActing] = useState(false);
  const [showSnooze, setShowSnooze] = useState(false);

  const now = new Date();
  const dueDate = new Date(reminder.due_at);
  const isOverdue = dueDate < now;
  const isToday =
    dueDate.toDateString() === now.toDateString() && !isOverdue;

  async function handleAction(status: string, extra?: Partial<Reminder>) {
    setActing(true);
    try {
      await api.updateReminder(reminder.id, { status, ...extra });
      revalidate("reminder-counts");
      onAction();
    } finally {
      setActing(false);
    }
  }

  function snoozeTo(days: number) {
    const d = new Date();
    d.setDate(d.getDate() + days);
    d.setHours(9, 0, 0, 0);
    handleAction("snoozed", { snoozed_until: d.toISOString() });
    setShowSnooze(false);
  }

  return (
    <div className="flex flex-col gap-2 p-3 border border-border rounded-lg">
      <div className="flex items-start gap-3">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-1">
            <Link
              href={`/leads/${reminder.lead}`}
              className="text-sm font-medium text-primary hover:underline truncate"
            >
              {reminder.lead_name}
            </Link>
            {isOverdue && <Badge variant="destructive">Overdue</Badge>}
            {isToday && <Badge variant="warning">Today</Badge>}
          </div>
          {reminder.note && (
            <p className="text-sm text-muted-foreground line-clamp-2">
              {reminder.note}
            </p>
          )}
          <p className="text-xs text-muted-foreground mt-1">
            Due: {formatDue(reminder.due_at)}
          </p>
        </div>
        <div className="flex items-center gap-1 shrink-0">
          <Button
            size="sm"
            variant="default"
            disabled={acting}
            onClick={() => handleAction("done")}
          >
            Done
          </Button>
          <Button
            size="sm"
            variant="secondary"
            disabled={acting}
            onClick={() => setShowSnooze(!showSnooze)}
          >
            Snooze
          </Button>
          <Button
            size="sm"
            variant="ghost"
            disabled={acting}
            onClick={() => handleAction("dismissed")}
          >
            Dismiss
          </Button>
        </div>
      </div>
      {showSnooze && (
        <div className="flex items-center gap-2 pt-1 border-t border-border">
          <span className="text-xs text-muted-foreground">Snooze for:</span>
          {[
            { label: "1 day", days: 1 },
            { label: "3 days", days: 3 },
            { label: "1 week", days: 7 },
          ].map((opt) => (
            <button
              key={opt.days}
              onClick={() => snoozeTo(opt.days)}
              disabled={acting}
              className="px-2 py-1 text-xs font-medium rounded border border-border bg-background hover:bg-muted transition-colors"
            >
              {opt.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

export default function FollowUpsPage() {
  const { data: reminders = [], mutate } = useReminders({ status: "pending" });

  const now = new Date();
  const todayEnd = new Date(now);
  todayEnd.setHours(23, 59, 59, 999);
  const weekEnd = new Date(now);
  weekEnd.setDate(weekEnd.getDate() + 7);

  const overdue = reminders.filter((r) => new Date(r.due_at) < now);
  const dueToday = reminders.filter((r) => {
    const d = new Date(r.due_at);
    return d >= now && d <= todayEnd;
  });
  const upcoming = reminders.filter((r) => {
    const d = new Date(r.due_at);
    return d > todayEnd && d <= weekEnd;
  });
  const later = reminders.filter((r) => new Date(r.due_at) > weekEnd);

  const handleRefresh = () => {
    mutate();
    revalidate("reminder-counts");
  };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-foreground">Follow-ups</h1>
        <p className="text-muted-foreground mt-1">
          Your pending follow-up reminders
        </p>
      </div>

      {reminders.length === 0 && (
        <Card>
          <CardContent className="p-8 text-center text-muted-foreground">
            No pending follow-ups. You&apos;re all caught up!
          </CardContent>
        </Card>
      )}

      {overdue.length > 0 && (
        <div>
          <h2 className="text-sm font-semibold text-red-600 mb-2 flex items-center gap-2">
            Overdue
            <Badge variant="destructive">{overdue.length}</Badge>
          </h2>
          <div className="space-y-2">
            {overdue.map((r) => (
              <div key={r.id} className="relative">
                <ReminderCard reminder={r} onAction={handleRefresh} />
              </div>
            ))}
          </div>
        </div>
      )}

      {dueToday.length > 0 && (
        <div>
          <h2 className="text-sm font-semibold text-amber-600 mb-2 flex items-center gap-2">
            Due Today
            <Badge variant="warning">{dueToday.length}</Badge>
          </h2>
          <div className="space-y-2">
            {dueToday.map((r) => (
              <div key={r.id} className="relative">
                <ReminderCard reminder={r} onAction={handleRefresh} />
              </div>
            ))}
          </div>
        </div>
      )}

      {upcoming.length > 0 && (
        <div>
          <h2 className="text-sm font-semibold text-foreground mb-2 flex items-center gap-2">
            Next 7 Days
            <Badge variant="secondary">{upcoming.length}</Badge>
          </h2>
          <div className="space-y-2">
            {upcoming.map((r) => (
              <div key={r.id} className="relative">
                <ReminderCard reminder={r} onAction={handleRefresh} />
              </div>
            ))}
          </div>
        </div>
      )}

      {later.length > 0 && (
        <div>
          <h2 className="text-sm font-semibold text-muted-foreground mb-2 flex items-center gap-2">
            Later
            <Badge variant="secondary">{later.length}</Badge>
          </h2>
          <div className="space-y-2">
            {later.map((r) => (
              <div key={r.id} className="relative">
                <ReminderCard reminder={r} onAction={handleRefresh} />
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
