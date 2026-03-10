"use client";

import { ActivityLogEntry } from "@/lib/api";
import { useLeadActivity, useDateFormat } from "@/lib/hooks";
import { formatDate, formatDateTime } from "@/lib/dateFormat";
import { Card, CardContent } from "@/components/ui/card";

const ACTION_ICONS: Record<string, string> = {
  created: "+",
  updated: "~",
  status_change: ">",
  assigned: "@",
  won: "*",
  deleted: "x",
};

const ACTION_COLORS: Record<string, string> = {
  created: "bg-blue-500",
  updated: "bg-gray-400",
  status_change: "bg-amber-500",
  assigned: "bg-purple-500",
  won: "bg-green-500",
  deleted: "bg-red-500",
};

function timeAgo(dateStr: string, dateFormat: string): string {
  const now = new Date();
  const date = new Date(dateStr);
  const seconds = Math.floor((now.getTime() - date.getTime()) / 1000);
  if (seconds < 60) return "just now";
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 30) return `${days}d ago`;
  return formatDate(dateStr, dateFormat);
}

export default function ActivityTimeline({ leadId }: { leadId: number }) {
  const dateFormat = useDateFormat();
  const { data: activities, isLoading } = useLeadActivity(leadId);

  if (isLoading) {
    return <p className="text-sm text-muted-foreground">Loading activity...</p>;
  }

  if (!activities || activities.length === 0) {
    return <p className="text-sm text-muted-foreground">No activity recorded yet.</p>;
  }

  return (
    <div className="relative">
      {/* Vertical line */}
      <div className="absolute left-3 top-2 bottom-2 w-px bg-border" />

      <div className="space-y-4">
        {activities.map((entry) => (
          <div key={entry.id} className="flex gap-3 relative">
            {/* Dot */}
            <div
              className={`w-6 h-6 rounded-full flex items-center justify-center text-white text-xs font-bold shrink-0 z-10 ${ACTION_COLORS[entry.action] || "bg-gray-400"}`}
            >
              {ACTION_ICONS[entry.action] || "?"}
            </div>

            {/* Content */}
            <div className="flex-1 min-w-0">
              <p className="text-sm text-foreground">{entry.description}</p>
              <p className="text-xs text-muted-foreground">
                {entry.user_name && <span>{entry.user_name} &middot; </span>}
                <span title={formatDateTime(entry.created_at, dateFormat)}>
                  {timeAgo(entry.created_at, dateFormat)}
                </span>
              </p>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
