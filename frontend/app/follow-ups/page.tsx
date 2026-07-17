"use client";

import { useState } from "react";
import Link from "next/link";
import { api, Reminder, FollowUpDraft, FollowUpPreview } from "@/lib/api";
import { useReminders, useDateFormat, useFollowUpDrafts, useUsers } from "@/lib/hooks";
import { revalidate } from "@/lib/hooks";
import { useAuth } from "@/lib/auth";
import { formatDate, formatDateTime as sharedFormatDateTime } from "@/lib/dateFormat";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import { Avatar } from "@/components/ui/avatar";
import { cn } from "@/lib/utils";

function formatDue(dateStr: string, dateFormat: string) {
  const d = new Date(dateStr);
  const now = new Date();
  const diffMs = d.getTime() - now.getTime();
  const diffMins = Math.round(diffMs / 60000);
  const diffHours = Math.round(diffMs / 3600000);

  const fallback = sharedFormatDateTime(dateStr, dateFormat);

  if (diffMins < 0) {
    const ago = Math.abs(diffMins);
    if (ago < 60) return `${ago}m ago`;
    if (ago < 1440) return `${Math.round(ago / 60)}h ago`;
    return fallback;
  }
  if (diffMins < 60) return `in ${diffMins}m`;
  if (diffHours < 24) return `in ${diffHours}h`;
  return fallback;
}

function ReminderCard({
  reminder,
  onAction,
  showAssignee,
}: {
  reminder: Reminder;
  onAction: () => void;
  showAssignee?: boolean;
}) {
  const dateFormat = useDateFormat();
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
            Due: {formatDue(reminder.due_at, dateFormat)}
          </p>
        </div>
        {showAssignee && reminder.user_name && (
          <span className="flex items-center gap-1.5 shrink-0 text-xs text-muted-foreground">
            <Avatar name={reminder.user_name} size="sm" />
            {reminder.user_name}
          </span>
        )}
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

function RemindersTab() {
  const { user: currentUser } = useAuth();
  // Salespeople only ever see their own follow-ups; admins/owners can view the
  // whole team and filter by person.
  const canViewTeam = !!currentUser && currentUser.role !== "salesperson";
  const [personFilter, setPersonFilter] = useState("");

  const { data: users = [] } = useUsers();
  const { data: reminders = [], mutate } = useReminders({
    status: "pending",
    user: canViewTeam ? personFilter || undefined : undefined,
  });

  const viewingTeam = canViewTeam && personFilter === "";

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
      {canViewTeam && (
        <div className="flex justify-end">
          <select
            value={personFilter}
            onChange={(e) => setPersonFilter(e.target.value)}
            className="h-9 rounded-md border border-border bg-background px-3 text-sm"
            aria-label="Filter follow-ups by person"
          >
            <option value="">All (team)</option>
            <option value="me">Me</option>
            {users.map((u) => (
              <option key={u.id} value={String(u.id)}>
                {`${u.first_name} ${u.last_name}`.trim() || u.email}
              </option>
            ))}
          </select>
        </div>
      )}

      {reminders.length === 0 && (
        <Card>
          <CardContent className="p-8 text-center text-muted-foreground">
            No pending reminders. You&apos;re all caught up!
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
                <ReminderCard reminder={r} onAction={handleRefresh} showAssignee={viewingTeam} />
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
                <ReminderCard reminder={r} onAction={handleRefresh} showAssignee={viewingTeam} />
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
                <ReminderCard reminder={r} onAction={handleRefresh} showAssignee={viewingTeam} />
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
                <ReminderCard reminder={r} onAction={handleRefresh} showAssignee={viewingTeam} />
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function DraftReviewCard({ draft, onDone }: { draft: FollowUpDraft; onDone: () => void }) {
  const dateFormat = useDateFormat();
  const [body, setBody] = useState(draft.body);
  // Size the editor to the message so the whole draft is readable at once.
  const rows = Math.min(
    14,
    Math.max(4, body.split("\n").reduce((n, line) => n + Math.max(1, Math.ceil(line.length / 70)), 1)),
  );
  const [busy, setBusy] = useState<"" | "approve" | "dismiss">("");
  const [error, setError] = useState("");

  const handleApprove = async () => {
    setBusy("approve");
    setError("");
    try {
      await api.approveFollowUpDraft(draft.id, body !== draft.body ? body : undefined);
      revalidate("followup-draft-count");
      onDone();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to send");
      setBusy("");
    }
  };

  const handleDismiss = async () => {
    setBusy("dismiss");
    setError("");
    try {
      await api.dismissFollowUpDraft(draft.id);
      revalidate("followup-draft-count");
      onDone();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to dismiss");
      setBusy("");
    }
  };

  return (
    <div className="p-3 border border-border rounded-lg flex gap-3">
      <div className="flex-1 min-w-0 space-y-2">
        <div className="flex items-center gap-2">
          <Link href={`/leads/${draft.lead}`} className="text-sm font-medium text-primary hover:underline truncate">
            {draft.lead_name || `Lead #${draft.lead}`}
          </Link>
          <Badge variant="secondary">AI</Badge>
        </div>
        {draft.reasoning && <p className="text-xs text-muted-foreground italic">{draft.reasoning}</p>}
        <Textarea value={body} onChange={(e) => setBody(e.target.value)} rows={rows} />
        {error && <p className="text-sm text-destructive">{error}</p>}
        <div className="flex items-center gap-2">
          <Button size="sm" onClick={handleApprove} disabled={!!busy || !body.trim()}>
            {busy === "approve" ? "Sending..." : "Approve & Send"}
          </Button>
          <Button size="sm" variant="ghost" onClick={handleDismiss} disabled={!!busy}>
            {busy === "dismiss" ? "Dismissing..." : "Dismiss"}
          </Button>
        </div>
      </div>
      <aside className="hidden sm:block w-40 shrink-0 border-l border-border pl-3 text-xs text-muted-foreground space-y-1.5">
        {draft.lead_event_type && (
          <p className="uppercase tracking-wide">{draft.lead_event_type}</p>
        )}
        {draft.lead_event_date && (
          <p>{formatDate(draft.lead_event_date, dateFormat)}</p>
        )}
        {draft.lead_guest_estimate != null && <p>{draft.lead_guest_estimate} guests</p>}
        {draft.lead_days_stale != null && (
          <p className="text-amber-600 font-medium">{draft.lead_days_stale}d quiet</p>
        )}
        {draft.lead_assigned_to_name && (
          <p className="flex items-center gap-1.5 pt-1">
            <Avatar name={draft.lead_assigned_to_name} size="sm" />
            <span className="truncate">{draft.lead_assigned_to_name}</span>
          </p>
        )}
      </aside>
    </div>
  );
}

type GenerateSummary = {
  created: number;
  skipped: { name: string; reasoning: string }[];
  ineligible: number;
  failed: number;
};

function GeneratePanel({ onDraftCreated }: { onDraftCreated: () => void }) {
  const dateFormat = useDateFormat();
  const [preview, setPreview] = useState<FollowUpPreview | null>(null);
  const [loading, setLoading] = useState(false);
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);
  const [summary, setSummary] = useState<GenerateSummary | null>(null);
  const [error, setError] = useState("");

  const openPreview = async () => {
    setLoading(true);
    setError("");
    setSummary(null);
    try {
      const p = await api.getFollowUpPreview();
      setPreview(p);
      setSelected(new Set(p.leads.map((l) => l.id)));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not load the preview");
    } finally {
      setLoading(false);
    }
  };

  const toggle = (id: number) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const toggleAll = () => {
    if (!preview) return;
    setSelected((prev) =>
      prev.size === preview.leads.length ? new Set() : new Set(preview.leads.map((l) => l.id)),
    );
  };

  const generate = async () => {
    if (!preview) return;
    const targets = preview.leads.filter((l) => selected.has(l.id));
    const result: GenerateSummary = { created: 0, skipped: [], ineligible: 0, failed: 0 };
    setProgress({ done: 0, total: targets.length });
    // A few drafts in flight at once — each lead is still its own isolated
    // call (no cross-lead data), this only shortens the wall-clock wait.
    const CONCURRENCY = 4;
    let next = 0;
    const worker = async () => {
      while (next < targets.length) {
        const lead = targets[next++];
        try {
          const res = await api.generateFollowUpDraft(lead.id);
          if (res.status === "created") {
            result.created += 1;
            onDraftCreated(); // draft appears in the queue as it lands
          } else if (res.status === "skipped") {
            result.skipped.push({ name: lead.contact_name, reasoning: res.reasoning });
          } else {
            result.ineligible += 1;
          }
        } catch {
          result.failed += 1;
        }
        setProgress((p) => (p ? { ...p, done: p.done + 1 } : p));
      }
    };
    await Promise.all(
      Array.from({ length: Math.min(CONCURRENCY, targets.length) }, () => worker()),
    );
    setProgress(null);
    setPreview(null);
    setSummary(result);
    revalidate("followup-draft-count");
  };

  if (progress) {
    return (
      <Card>
        <CardContent className="p-4 space-y-2">
          <p className="text-sm font-medium text-foreground">
            Drafting follow-ups… {progress.done} of {progress.total}
          </p>
          <div className="h-2 rounded-full bg-muted overflow-hidden">
            <div
              className="h-full bg-primary transition-all"
              style={{ width: `${(progress.done / Math.max(progress.total, 1)) * 100}%` }}
            />
          </div>
          <p className="text-xs text-muted-foreground">
            Drafts appear in the queue below as they're created. Leaving this page keeps
            whatever has finished.
          </p>
        </CardContent>
      </Card>
    );
  }

  if (preview) {
    if (preview.leads.length === 0) {
      return (
        <Card>
          <CardContent className="p-4 flex items-center justify-between gap-4">
            <p className="text-sm text-muted-foreground">
              No stale leads right now — nothing has gone quiet for more than{" "}
              {preview.first_gap_days} days.
            </p>
            <Button size="sm" variant="ghost" onClick={() => setPreview(null)}>
              Close
            </Button>
          </CardContent>
        </Card>
      );
    }
    return (
      <Card>
        <CardContent className="p-4 space-y-3">
          <div className="flex items-center justify-between gap-4">
            <p className="text-sm font-medium text-foreground">
              {selected.size} of {preview.leads.length} stale lead
              {preview.leads.length === 1 ? "" : "s"} selected for a follow-up draft
            </p>
            <button
              onClick={toggleAll}
              className="text-xs font-medium text-primary hover:underline"
            >
              {selected.size === preview.leads.length ? "Deselect all" : "Select all"}
            </button>
          </div>
          {!preview.configured && (
            <p className="text-sm text-destructive">
              AI follow-ups aren&apos;t fully configured (model or API key missing) —
              generation will fail until that's set up.
            </p>
          )}
          <div className="space-y-1 max-h-96 overflow-y-auto">
            {preview.leads.map((lead) => (
              <label
                key={lead.id}
                className="flex items-center gap-3 p-2 border border-border rounded-lg cursor-pointer hover:bg-muted/50"
              >
                <input
                  type="checkbox"
                  checked={selected.has(lead.id)}
                  onChange={() => toggle(lead.id)}
                  aria-label={`Draft a follow-up for ${lead.contact_name}`}
                />
                <div className="flex-1 min-w-0 flex items-center gap-3">
                  <Link
                    href={`/leads/${lead.id}`}
                    className="text-sm font-medium text-primary hover:underline truncate"
                    onClick={(e) => e.stopPropagation()}
                  >
                    {lead.contact_name}
                  </Link>
                  <span className="text-xs text-amber-600 font-medium shrink-0">
                    {lead.days_stale}d stale
                  </span>
                  <span className="text-xs text-muted-foreground uppercase tracking-wide shrink-0">
                    {lead.status}
                  </span>
                </div>
                <div className="flex items-center gap-3 shrink-0 text-xs text-muted-foreground">
                  {lead.event_date && <span>{formatDate(lead.event_date, dateFormat)}</span>}
                  {lead.budget && <span>{Number(lead.budget).toLocaleString()}</span>}
                  <span className="flex items-center gap-1.5">
                    <Avatar name={lead.assigned_to_name} size="sm" />
                    {lead.assigned_to_name || "Unassigned"}
                  </span>
                </div>
              </label>
            ))}
          </div>
          <div className="flex items-center gap-2">
            <Button size="sm" onClick={generate} disabled={selected.size === 0}>
              Create {selected.size} draft{selected.size === 1 ? "" : "s"}
            </Button>
            <Button size="sm" variant="ghost" onClick={() => setPreview(null)}>
              Cancel
            </Button>
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-end gap-2">
        {error && <p className="text-sm text-destructive">{error}</p>}
        <Button size="sm" variant="secondary" onClick={openPreview} disabled={loading}>
          {loading ? "Checking stale leads…" : "Generate follow-ups"}
        </Button>
      </div>
      {summary && (
        <Card className="max-w-3xl">
          <CardContent className="p-4 space-y-2">
            <p className="text-sm font-medium text-foreground">
              {summary.created} draft{summary.created === 1 ? "" : "s"} created
              {summary.skipped.length > 0 && `, ${summary.skipped.length} skipped by the AI`}
              {summary.ineligible > 0 && `, ${summary.ineligible} no longer eligible`}
              {summary.failed > 0 && `, ${summary.failed} failed`}
            </p>
            {summary.skipped.map((s, i) => (
              <p key={i} className="text-xs text-muted-foreground">
                <span className="font-medium">{s.name}:</span> {s.reasoning}
              </p>
            ))}
            <button
              onClick={() => setSummary(null)}
              className="text-xs font-medium text-primary hover:underline"
            >
              Dismiss
            </button>
          </CardContent>
        </Card>
      )}
    </div>
  );
}

function DraftsTab() {
  const { data: drafts = [], mutate } = useFollowUpDrafts("pending");
  const [bulkBusy, setBulkBusy] = useState(false);
  const [bulkError, setBulkError] = useState("");

  const handleBulkApprove = async () => {
    setBulkBusy(true);
    setBulkError("");
    try {
      const res = await api.bulkApproveFollowUpDrafts();
      revalidate("followup-draft-count");
      await mutate();
      if (res.failed.length > 0) {
        setBulkError(`${res.sent.length} sent, ${res.failed.length} failed (check WhatsApp is configured).`);
      }
    } catch (err) {
      setBulkError(err instanceof Error ? err.message : "Bulk approve failed");
    } finally {
      setBulkBusy(false);
    }
  };

  return (
    <div className="space-y-4">
      <GeneratePanel onDraftCreated={() => mutate()} />

      {drafts.length === 0 ? (
        <Card>
          <CardContent className="p-8 text-center text-muted-foreground">
            No AI drafts to review. Use &quot;Generate follow-ups&quot; to draft messages
            for leads that have gone quiet.
          </CardContent>
        </Card>
      ) : (
        <div className="max-w-3xl space-y-4">
          <div className="flex items-center justify-between">
            <p className="text-sm text-muted-foreground">
              {drafts.length} draft{drafts.length === 1 ? "" : "s"} awaiting your review.
            </p>
            <Button size="sm" onClick={handleBulkApprove} disabled={bulkBusy}>
              {bulkBusy ? "Sending..." : `Approve & send all (${drafts.length})`}
            </Button>
          </div>
          {bulkError && <p className="text-sm text-destructive">{bulkError}</p>}
          <div className="space-y-2">
            {drafts.map((d) => (
              <DraftReviewCard key={d.id} draft={d} onDone={() => mutate()} />
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

export default function FollowUpsPage() {
  const [tab, setTab] = useState<"reminders" | "drafts">("reminders");
  const { data: drafts = [] } = useFollowUpDrafts("pending");

  const tabs: { id: "reminders" | "drafts"; label: string; count?: number }[] = [
    { id: "reminders", label: "Reminders" },
    { id: "drafts", label: "AI Drafts", count: drafts.length },
  ];

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-foreground">Follow-ups</h1>
        <p className="text-muted-foreground mt-1">Reminders and AI-suggested follow-ups for quiet leads</p>
      </div>

      <div className="flex items-center gap-1 border-b border-border">
        {tabs.map((t) => (
          <button
            key={t.id}
            onClick={() => setTab(t.id)}
            className={cn(
              "px-4 py-2 text-sm font-medium border-b-2 -mb-px transition-colors flex items-center gap-2",
              tab === t.id
                ? "border-primary text-foreground"
                : "border-transparent text-muted-foreground hover:text-foreground"
            )}
          >
            {t.label}
            {t.count ? <Badge variant="secondary">{t.count}</Badge> : null}
          </button>
        ))}
      </div>

      {tab === "reminders" ? <RemindersTab /> : <DraftsTab />}
    </div>
  );
}
