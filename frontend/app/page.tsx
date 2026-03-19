"use client";

import { useState } from "react";
import Link from "next/link";
import { useAuth } from "@/lib/auth";
import { useEvents, useQuotes, useLeads, useDashboardStats, useSiteSettings, useReminderCounts, useDateFormat } from "@/lib/hooks";
import { formatDate } from "@/lib/dateFormat";
import { api, AutoAssignResult } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { mutate } from "swr";

const PERIODS = [
  { value: "all", label: "All Time" },
  { value: "today", label: "Today" },
  { value: "week", label: "This Week" },
  { value: "month", label: "This Month" },
  { value: "custom", label: "Custom" },
] as const;

function StatCard({ label, value, sub }: { label: string; value: string | number; sub?: string }) {
  return (
    <Card>
      <CardContent className="p-4 text-center">
        <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">{label}</p>
        <p className="text-2xl font-bold text-foreground mt-1">{value}</p>
        {sub && <p className="text-xs text-muted-foreground mt-0.5">{sub}</p>}
      </CardContent>
    </Card>
  );
}

export default function Dashboard() {
  const { user } = useAuth();
  const isManager = user?.role === "manager" || user?.role === "owner";
  const [period, setPeriod] = useState<string>("all");
  const [customFrom, setCustomFrom] = useState("");
  const [customTo, setCustomTo] = useState("");
  const [autoAssigning, setAutoAssigning] = useState(false);
  const [autoAssignResult, setAutoAssignResult] = useState<AutoAssignResult | null>(null);
  const { data: stats } = useDashboardStats(
    isManager ? period : null,
    period === "custom" ? customFrom || undefined : undefined,
    period === "custom" ? customTo || undefined : undefined,
  );
  const { data: rawSettings } = useSiteSettings();
  const cs = rawSettings?.currency_symbol || "\u00a3";
  const dateFormat = useDateFormat();

  const { data: reminderCounts } = useReminderCounts();
  const { data: allEvents } = useEvents({ date_from: new Date().toISOString().split("T")[0], page_size: 5 });
  const { data: allQuotes } = useQuotes("draft", 5);
  const { data: allLeads } = useLeads({ page_size: 5 });

  const events = allEvents || [];
  const quotes = allQuotes || [];
  const leads = allLeads || [];

  const summary = stats?.lead_summary;
  const kpis = stats?.kpis;
  const team = stats?.team_activity || [];
  const salespeople = stats?.salesperson_performance || [];
  const statusCols = stats?.status_columns || [];
  const statusDist = stats?.status_distribution || [];
  const lostReasons = stats?.lost_reasons || [];

  const pipelineValue = kpis ? Number(kpis.pipeline_value) : 0;
  const pipelineDisplay = pipelineValue >= 1000
    ? `${cs}${(pipelineValue / 1000).toFixed(pipelineValue >= 10000 ? 0 : 1)}k`
    : `${cs}${pipelineValue}`;

  return (
    <div className="space-y-8">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-foreground">Dashboard</h1>
          <p className="text-muted-foreground mt-1">Overview of your catering operations</p>
        </div>
        <div className="flex flex-wrap gap-3">
          <Button asChild size="sm">
            <Link href="/leads/new">New Lead</Link>
          </Button>
          <Button asChild size="sm">
            <Link href="/quotes/new">New Quote</Link>
          </Button>
          <Button asChild size="sm">
            <Link href="/events/new">New Event</Link>
          </Button>
          <Button asChild size="sm" variant="secondary">
            <Link href="/calculate">Calculator</Link>
          </Button>
        </div>
      </div>

      {isManager && (
      <>
      {/* Period Toggle */}
      <div className="flex items-center gap-3 flex-wrap">
        <div className="flex gap-1 bg-muted rounded-lg p-1 w-fit">
          {PERIODS.map((p) => (
            <button
              key={p.value}
              onClick={() => setPeriod(p.value)}
              className={`px-3 py-1.5 text-sm font-medium rounded-md transition-colors ${
                period === p.value
                  ? "bg-background text-foreground shadow-sm"
                  : "text-muted-foreground hover:text-foreground"
              }`}
            >
              {p.label}
            </button>
          ))}
        </div>
        {period === "custom" && (
          <div className="flex items-center gap-2">
            <input
              type="date"
              value={customFrom}
              onChange={(e) => setCustomFrom(e.target.value)}
              className="px-2 py-1.5 text-sm border border-border rounded-md bg-background text-foreground"
            />
            <span className="text-sm text-muted-foreground">to</span>
            <input
              type="date"
              value={customTo}
              onChange={(e) => setCustomTo(e.target.value)}
              className="px-2 py-1.5 text-sm border border-border rounded-md bg-background text-foreground"
            />
          </div>
        )}
      </div>

      {/* Lead Summary Cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <StatCard label="New Leads" value={summary?.new_leads ?? "-"} />
        <StatCard label="Won" value={summary?.won ?? "-"} />
        <StatCard label="Lost" value={summary?.lost ?? "-"} />
        <StatCard label="Active" value={summary?.total_active ?? "-"} />
      </div>

      {/* KPI Cards */}
      <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
        <StatCard label="Conversion Rate" value={kpis ? `${kpis.conversion_rate}%` : "-"} />
        <StatCard label="Avg Days to Convert" value={kpis?.avg_days_to_convert ?? "-"} />
        <StatCard
          label="Pipeline"
          value={kpis ? pipelineDisplay : "-"}
          sub={kpis ? `${kpis.pipeline_count} leads` : undefined}
        />
      </div>

      {/* Lead Status Distribution */}
      {statusDist.length > 0 && (() => {
        const maxCount = Math.max(...statusDist.map((s) => s.count), 1);
        const totalLeads = statusDist.reduce((sum, s) => sum + s.count, 0);
        return (
          <Card>
            <CardContent className="p-5">
              <div className="flex items-center justify-between mb-4">
                <h2 className="text-sm font-semibold text-foreground">Lead Distribution by Status</h2>
                <span className="text-xs text-muted-foreground">{totalLeads} total leads</span>
              </div>
              <div className="flex items-end gap-3 h-48">
                {statusDist.map((s) => {
                  const barHeight = maxCount > 0 ? (s.count / maxCount) * 100 : 0;
                  const pct = totalLeads > 0 ? Math.round((s.count / totalLeads) * 100) : 0;
                  return (
                    <div key={s.status} className="flex-1 flex flex-col items-center gap-1 h-full justify-end min-w-0">
                      <span className="text-xs font-medium text-foreground">{s.count}</span>
                      <div className="w-full flex items-end justify-center" style={{ height: "calc(100% - 2rem)" }}>
                        <div
                          className="w-full max-w-14 bg-primary rounded-t transition-all duration-500"
                          style={{ height: `${barHeight}%`, minHeight: s.count > 0 ? "4px" : "0" }}
                        />
                      </div>
                      <span className="text-[10px] text-muted-foreground text-center leading-tight truncate w-full">{s.label}</span>
                    </div>
                  );
                })}
              </div>
            </CardContent>
          </Card>
        );
      })()}

      {/* Lost Reasons */}
      {lostReasons.length > 0 && (() => {
        const maxCount = Math.max(...lostReasons.map((r) => r.count), 1);
        const totalLost = lostReasons.reduce((sum, r) => sum + r.count, 0);
        return (
          <Card>
            <CardContent className="p-5">
              <div className="flex items-center justify-between mb-4">
                <h2 className="text-sm font-semibold text-foreground">Lost Reasons</h2>
                <span className="text-xs text-muted-foreground">{totalLost} lost lead{totalLost !== 1 ? "s" : ""}</span>
              </div>
              <div className="flex items-end gap-3 h-48">
                {lostReasons.map((r) => {
                  const barHeight = maxCount > 0 ? (r.count / maxCount) * 100 : 0;
                  return (
                    <div key={r.reason} className="flex-1 flex flex-col items-center gap-1 h-full justify-end min-w-0">
                      <span className="text-xs font-medium text-foreground">{r.count}</span>
                      <div className="w-full flex items-end justify-center" style={{ height: "calc(100% - 2rem)" }}>
                        <div
                          className="w-full max-w-14 bg-red-500/70 rounded-t transition-all duration-500"
                          style={{ height: `${barHeight}%`, minHeight: r.count > 0 ? "4px" : "0" }}
                        />
                      </div>
                      <span className="text-[10px] text-muted-foreground text-center leading-tight truncate w-full" title={r.reason}>{r.reason}</span>
                    </div>
                  );
                })}
              </div>
            </CardContent>
          </Card>
        );
      })()}

      {/* Salesperson Performance */}
      {(
        <Card>
          <CardContent className="p-5">
            <div className="flex items-center justify-between mb-1">
              <h2 className="text-sm font-semibold text-foreground">Salesperson Performance</h2>
              <Button
                size="sm"
                variant="outline"
                disabled={autoAssigning}
                onClick={async () => {
                  setAutoAssigning(true);
                  setAutoAssignResult(null);
                  try {
                    const result = await api.autoAssignLeads();
                    setAutoAssignResult(result);
                    mutate(period === "custom"
                      ? `dashboard-stats-custom-${customFrom}-${customTo}`
                      : `dashboard-stats-${period}`);
                  } catch {
                    setAutoAssignResult({ assigned: -1, skipped_no_product: 0, skipped_no_staff: 0 });
                  } finally {
                    setAutoAssigning(false);
                  }
                }}
              >
                {autoAssigning ? "Assigning…" : "Auto-Assign"}
              </Button>
            </div>
            {autoAssignResult && (
              <p className={`text-xs mb-2 ${autoAssignResult.assigned === -1 ? "text-red-500" : "text-muted-foreground"}`}>
                {autoAssignResult.assigned === -1
                  ? "Auto-assign failed. Please try again."
                  : `Assigned ${autoAssignResult.assigned} lead${autoAssignResult.assigned !== 1 ? "s" : ""}`
                    + (autoAssignResult.skipped_no_product ? `, ${autoAssignResult.skipped_no_product} skipped (no product)` : "")
                    + (autoAssignResult.skipped_no_staff ? `, ${autoAssignResult.skipped_no_staff} skipped (no staff)` : "")
                    + "."}
              </p>
            )}
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-border text-left">
                    <th className="pb-2 pr-4 font-medium text-muted-foreground sticky left-0 bg-card">Salesperson</th>
                    {statusCols.map((sc) => (
                      <th key={sc.value} className="pb-2 px-2 font-medium text-muted-foreground text-center">{sc.label}</th>
                    ))}
                    <th className="pb-2 px-2 font-medium text-muted-foreground text-center border-l border-border">Value</th>
                    <th className="pb-2 px-2 font-medium text-muted-foreground text-center border-l border-border" title="Overdue follow-up reminders">Overdue</th>
                    <th className="pb-2 px-2 font-medium text-muted-foreground text-center" title="Leads with no activity in 7+ days">Stale</th>
                  </tr>
                </thead>
                <tbody>
                  {salespeople.length === 0 ? (
                    <tr>
                      <td colSpan={statusCols.length + 4} className="py-6 text-center text-sm text-muted-foreground">
                        No leads in this period
                      </td>
                    </tr>
                  ) : salespeople.map((sp) => (
                    <tr key={sp.user_id ?? "unassigned"} className={`border-b border-border last:border-0 ${sp.user_id === null ? "italic text-muted-foreground" : ""}`}>
                      <td className="py-2 pr-4 font-medium sticky left-0 bg-card">{sp.user_name}</td>
                      {statusCols.map((sc) => (
                        <td key={sc.value} className="py-2 px-2 text-center">
                          {sp.pipeline[sc.value] || <span className="text-muted-foreground">-</span>}
                        </td>
                      ))}
                      <td className="py-2 px-2 text-center border-l border-border">
                        {sp.pipeline_value > 0
                          ? `${cs}${sp.pipeline_value >= 1000 ? `${(sp.pipeline_value / 1000).toFixed(sp.pipeline_value >= 10000 ? 0 : 1)}k` : sp.pipeline_value}`
                          : <span className="text-muted-foreground">-</span>}
                      </td>
                      <td className="py-2 px-2 text-center border-l border-border">
                        {sp.overdue_reminders ? <span className="text-red-500 font-medium">{sp.overdue_reminders}</span> : <span className="text-muted-foreground">-</span>}
                      </td>
                      <td className="py-2 px-2 text-center">
                        {sp.stale_leads ? <span className="text-amber-500 font-medium">{sp.stale_leads}</span> : <span className="text-muted-foreground">-</span>}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>
      )}
      </>
      )}

      {/* Follow-up Reminders */}
      {reminderCounts && (reminderCounts.overdue > 0 || reminderCounts.due_today > 0) && (
        <Card>
          <CardContent className="p-4">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-4">
                {reminderCounts.overdue > 0 && (
                  <div className="flex items-center gap-2">
                    <Badge variant="destructive">{reminderCounts.overdue}</Badge>
                    <span className="text-sm text-foreground">overdue follow-up{reminderCounts.overdue !== 1 ? "s" : ""}</span>
                  </div>
                )}
                {reminderCounts.due_today > 0 && (
                  <div className="flex items-center gap-2">
                    <Badge variant="warning">{reminderCounts.due_today}</Badge>
                    <span className="text-sm text-foreground">due today</span>
                  </div>
                )}
              </div>
              <Link href="/follow-ups" className="text-sm text-primary hover:underline">
                View follow-ups &rarr;
              </Link>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Existing 3-column lists */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Upcoming Events */}
        <DashboardCard title="Upcoming Events" viewAllHref="/events">
          {events.length === 0 ? (
            <p className="text-sm text-muted-foreground">No upcoming events</p>
          ) : (
            <ul className="space-y-3">
              {events.map((ev) => (
                <li key={ev.id}>
                  <Link href={`/events/${ev.id}`} className="block hover:bg-muted -mx-1 px-1 py-1 rounded transition-colors">
                    <p className="text-sm font-medium text-foreground truncate">{ev.name}</p>
                    <div className="flex items-center gap-2 text-xs text-muted-foreground">
                      <span>{formatDate(ev.date, dateFormat)}</span>
                      <span className="text-border">|</span>
                      <span>{ev.gents + ev.ladies} guests</span>
                      <Badge variant="secondary" className="text-[10px] px-1.5 py-0.5">{ev.status_display}</Badge>
                    </div>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </DashboardCard>

        {/* Pending Quotes */}
        <DashboardCard title="Pending Quotes" viewAllHref="/quotes">
          {quotes.length === 0 ? (
            <p className="text-sm text-muted-foreground">No pending quotes</p>
          ) : (
            <ul className="space-y-3">
              {quotes.map((q) => (
                <li key={q.id}>
                  <Link href={`/quotes/${q.id}`} className="block hover:bg-muted -mx-1 px-1 py-1 rounded transition-colors">
                    <p className="text-sm font-medium text-foreground truncate">
                      {q.account_name || "No account"}
                    </p>
                    <div className="flex items-center gap-2 text-xs text-muted-foreground">
                      <span>{formatDate(q.event_date, dateFormat)}</span>
                      <span className="text-border">|</span>
                      <span>{q.guest_count} guests</span>
                      <Badge variant="secondary" className="text-[10px] px-1.5 py-0.5">{q.status_display}</Badge>
                    </div>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </DashboardCard>

        {/* Recent Leads */}
        <DashboardCard title="Recent Leads" viewAllHref="/leads">
          {leads.length === 0 ? (
            <p className="text-sm text-muted-foreground">No leads yet</p>
          ) : (
            <ul className="space-y-3">
              {leads.map((l) => (
                <li key={l.id}>
                  <Link href={`/leads/${l.id}`} className="block hover:bg-muted -mx-1 px-1 py-1 rounded transition-colors">
                    <p className="text-sm font-medium text-foreground truncate">{l.contact_name}</p>
                    <div className="flex items-center gap-2 text-xs text-muted-foreground">
                      <span>{l.event_type_display}</span>
                      {l.event_date && (
                        <>
                          <span className="text-border">|</span>
                          <span>{formatDate(l.event_date, dateFormat)}</span>
                        </>
                      )}
                      <Badge variant="secondary" className="text-[10px] px-1.5 py-0.5">{l.status_display}</Badge>
                    </div>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </DashboardCard>
      </div>
    </div>
  );
}

function DashboardCard({
  title,
  viewAllHref,
  children,
}: {
  title: string;
  viewAllHref: string;
  children: React.ReactNode;
}) {
  return (
    <Card>
      <CardContent className="p-5">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-sm font-semibold text-foreground">{title}</h2>
          <Link href={viewAllHref} className="text-xs text-primary hover:underline">
            View all &rarr;
          </Link>
        </div>
        {children}
      </CardContent>
    </Card>
  );
}
