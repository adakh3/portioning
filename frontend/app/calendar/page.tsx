"use client";

import { Suspense, useState, useMemo } from "react";
import Link from "next/link";
import { useAuth } from "@/lib/auth";
import { api, CalendarDay, LockedDate as LockedDateType } from "@/lib/api";
import { useEventCalendar, useLockedDates, useProductLines, revalidate } from "@/lib/hooks";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

export default function CalendarPage() {
  return (
    <Suspense>
      <CalendarContent />
    </Suspense>
  );
}

const STATUS_OPTIONS = [
  { value: "", label: "All Statuses" },
  { value: "tentative", label: "Tentative" },
  { value: "confirmed", label: "Confirmed" },
  { value: "tentative,confirmed", label: "Tentative + Confirmed" },
  { value: "in_progress", label: "In Progress" },
  { value: "completed", label: "Completed" },
];

const STATUS_VARIANT: Record<string, "default" | "warning" | "success" | "secondary" | "info" | "destructive"> = {
  tentative: "warning",
  confirmed: "success",
  in_progress: "info",
  completed: "secondary",
  cancelled: "destructive",
};

const WEEKDAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

function CalendarContent() {
  const { user } = useAuth();
  const isAdmin = user?.role === "manager" || user?.role === "owner";

  const today = new Date();
  const [year, setYear] = useState(today.getFullYear());
  const [month, setMonth] = useState(today.getMonth() + 1);
  const [statusFilter, setStatusFilter] = useState("");
  const [productFilter, setProductFilter] = useState("");
  const [selectedDate, setSelectedDate] = useState<string | null>(null);
  const [lockReason, setLockReason] = useState("");
  const [locking, setLocking] = useState(false);

  const monthStr = `${year}-${String(month).padStart(2, "0")}`;
  const { data: calendarDays = [], isLoading } = useEventCalendar(
    monthStr,
    statusFilter || undefined,
    productFilter || undefined
  );
  const { data: lockedDates = [] } = useLockedDates(monthStr);
  const { data: productLines = [] } = useProductLines();

  const dayMap = useMemo(() => {
    const m = new Map<string, CalendarDay>();
    for (const d of calendarDays) m.set(d.date, d);
    return m;
  }, [calendarDays]);

  const lockedMap = useMemo(() => {
    const m = new Map<string, LockedDateType>();
    for (const ld of lockedDates) m.set(ld.date, ld);
    return m;
  }, [lockedDates]);

  const calendarCells = useMemo(() => {
    const firstDay = new Date(year, month - 1, 1);
    const lastDay = new Date(year, month, 0).getDate();
    let startDow = firstDay.getDay() - 1;
    if (startDow < 0) startDow = 6;

    const cells: (number | null)[] = [];
    for (let i = 0; i < startDow; i++) cells.push(null);
    for (let d = 1; d <= lastDay; d++) cells.push(d);
    while (cells.length % 7 !== 0) cells.push(null);
    return cells;
  }, [year, month]);

  const monthLabel = new Date(year, month - 1, 1).toLocaleString("default", {
    month: "long",
    year: "numeric",
  });

  function navigate(delta: number) {
    let newMonth = month + delta;
    let newYear = year;
    if (newMonth < 1) { newMonth = 12; newYear--; }
    else if (newMonth > 12) { newMonth = 1; newYear++; }
    setMonth(newMonth);
    setYear(newYear);
    setSelectedDate(null);
  }

  function goToday() {
    const t = new Date();
    setYear(t.getFullYear());
    setMonth(t.getMonth() + 1);
    setSelectedDate(null);
  }

  const todayStr = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, "0")}-${String(today.getDate()).padStart(2, "0")}`;

  function dateStr(day: number): string {
    return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
  }

  const selectedDayData = selectedDate ? dayMap.get(selectedDate) : null;
  const selectedLocked = selectedDate ? lockedMap.get(selectedDate) : null;

  async function handleLock() {
    if (!selectedDate) return;
    setLocking(true);
    try {
      await api.lockDate({ date: selectedDate, reason: lockReason });
      setLockReason("");
      revalidate(`locked-dates-${monthStr}`);
    } catch { /* silently fail */ }
    finally { setLocking(false); }
  }

  async function handleUnlock(id: number) {
    setLocking(true);
    try {
      await api.unlockDate(id);
      revalidate(`locked-dates-${monthStr}`);
    } catch { /* silently fail */ }
    finally { setLocking(false); }
  }

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold text-foreground">Calendar</h1>
      </div>

      {/* Controls */}
      <div className="flex flex-wrap items-end gap-2">
        <div className="flex items-center gap-1">
          <Button variant="outline" size="sm" onClick={() => navigate(-1)}>
            &larr;
          </Button>
          <Button variant="outline" size="sm" onClick={goToday}>
            Today
          </Button>
          <Button variant="outline" size="sm" onClick={() => navigate(1)}>
            &rarr;
          </Button>
        </div>
        <h2 className="text-lg font-semibold text-foreground min-w-[180px]">
          {monthLabel}
        </h2>
        <select
          className="h-9 rounded-md border border-input bg-transparent px-3 text-sm focus-visible:ring-1 focus-visible:ring-ring"
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value)}
        >
          {STATUS_OPTIONS.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>
        {productLines.length > 0 && (
          <select
            className="h-9 rounded-md border border-input bg-transparent px-3 text-sm focus-visible:ring-1 focus-visible:ring-ring"
            value={productFilter}
            onChange={(e) => setProductFilter(e.target.value)}
          >
            <option value="">All Products</option>
            {productLines.map((pl) => (
              <option key={pl.id} value={String(pl.id)}>
                {pl.name}
              </option>
            ))}
          </select>
        )}
      </div>

      <div className="flex gap-4">
        {/* Calendar grid */}
        <Card className="flex-1">
          <CardContent className="p-0">
            <div className="grid grid-cols-7 border-b border-border">
              {WEEKDAYS.map((d) => (
                <div
                  key={d}
                  className="py-2 text-center text-xs font-medium text-muted-foreground uppercase tracking-wide"
                >
                  {d}
                </div>
              ))}
            </div>
            <div className="grid grid-cols-7">
              {calendarCells.map((day, i) => {
                if (day === null) {
                  return (
                    <div
                      key={`empty-${i}`}
                      className="min-h-[100px] border-r border-b border-border bg-muted/30 last:border-r-0"
                    />
                  );
                }
                const ds = dateStr(day);
                const dayData = dayMap.get(ds);
                const locked = lockedMap.get(ds);
                const isToday = ds === todayStr;
                const isSelected = ds === selectedDate;

                // Collect unique product colour dots
                const productDots: string[] = [];
                if (dayData) {
                  const seen = new Set<string>();
                  for (const evt of dayData.my_events) {
                    if (evt.product_colour && !seen.has(evt.product_colour)) {
                      seen.add(evt.product_colour);
                      productDots.push(evt.product_colour);
                    }
                  }
                }

                return (
                  <button
                    key={ds}
                    onClick={() => setSelectedDate(ds)}
                    className={cn(
                      "min-h-[100px] border-r border-b border-border p-1.5 text-left transition-colors hover:bg-accent/50 relative",
                      isSelected && "bg-accent ring-2 ring-ring ring-inset",
                      locked && "bg-destructive/5"
                    )}
                  >
                    <div className="flex items-start justify-between">
                      <span
                        className={cn(
                          "inline-flex h-6 w-6 items-center justify-center rounded-full text-xs font-medium",
                          isToday
                            ? "bg-primary text-primary-foreground"
                            : "text-foreground"
                        )}
                      >
                        {day}
                      </span>
                      {locked && (
                        <span className="text-[10px] text-destructive font-medium" title={locked.reason || "Locked"}>
                          Locked
                        </span>
                      )}
                    </div>
                    {dayData && (
                      <div className="mt-1 space-y-0.5">
                        {/* Product colour dots */}
                        {productDots.length > 0 && (
                          <div className="flex gap-0.5 mb-0.5">
                            {productDots.map((colour) => (
                              <span
                                key={colour}
                                className="inline-block h-2 w-2 rounded-full"
                                style={{ backgroundColor: colour }}
                              />
                            ))}
                          </div>
                        )}
                        <div className="text-[10px] font-medium text-foreground">
                          {dayData.my_event_count} event{dayData.my_event_count !== 1 ? "s" : ""}
                        </div>
                        <div className="text-[10px] text-muted-foreground">
                          {dayData.my_total_guests} guests
                        </div>
                        {/* Org-wide context for salespeople (when different from my counts) */}
                        {dayData.org_event_count > dayData.my_event_count && (
                          <div className="text-[9px] text-muted-foreground/60">
                            {dayData.org_event_count} org-wide
                          </div>
                        )}
                      </div>
                    )}
                  </button>
                );
              })}
            </div>
          </CardContent>
        </Card>

        {/* Side panel */}
        {selectedDate && (
          <div className="w-80 shrink-0 space-y-4">
            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-sm font-semibold">
                  {new Date(selectedDate + "T00:00:00").toLocaleDateString(
                    "default",
                    { weekday: "long", day: "numeric", month: "long", year: "numeric" }
                  )}
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                {/* Locked status */}
                {selectedLocked ? (
                  <div className="rounded-md bg-destructive/10 border border-destructive/20 p-3 space-y-2">
                    <div className="flex items-center justify-between">
                      <span className="text-sm font-medium text-destructive">
                        Date Locked
                      </span>
                      {isAdmin && (
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => handleUnlock(selectedLocked.id)}
                          disabled={locking}
                        >
                          Unlock
                        </Button>
                      )}
                    </div>
                    {selectedLocked.reason && (
                      <p className="text-xs text-muted-foreground">
                        {selectedLocked.reason}
                      </p>
                    )}
                    <p className="text-xs text-muted-foreground">
                      by {selectedLocked.locked_by_name}
                    </p>
                  </div>
                ) : isAdmin ? (
                  <div className="space-y-2">
                    <Input
                      type="text"
                      placeholder="Lock reason (optional)"
                      value={lockReason}
                      onChange={(e) => setLockReason(e.target.value)}
                    />
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={handleLock}
                      disabled={locking}
                      className="w-full"
                    >
                      Lock Date
                    </Button>
                  </div>
                ) : null}

                {/* Events */}
                {selectedDayData && selectedDayData.my_events.length > 0 ? (
                  <div className="space-y-2">
                    <div className="flex items-center justify-between text-xs text-muted-foreground">
                      <span>
                        {selectedDayData.my_event_count} event{selectedDayData.my_event_count !== 1 ? "s" : ""}
                      </span>
                      <span>{selectedDayData.my_total_guests} guests</span>
                    </div>
                    {/* Org-wide context */}
                    {selectedDayData.org_event_count > selectedDayData.my_event_count && (
                      <div className="text-[10px] text-muted-foreground/60">
                        {selectedDayData.org_event_count} events org-wide &middot; {selectedDayData.org_total_guests} guests total
                      </div>
                    )}
                    {selectedDayData.my_events.map((evt) => (
                      <Link
                        key={evt.id}
                        href={`/events/${evt.id}`}
                        className="block rounded-md border border-border p-3 hover:border-primary/40 transition-colors"
                      >
                        <div className="flex items-center justify-between gap-2">
                          <div className="flex items-center gap-1.5 min-w-0">
                            {evt.product_colour && (
                              <span
                                className="inline-block h-2.5 w-2.5 rounded-full shrink-0"
                                style={{ backgroundColor: evt.product_colour }}
                              />
                            )}
                            <span className="text-sm font-medium text-foreground truncate">
                              {evt.name}
                            </span>
                          </div>
                          <Badge variant={STATUS_VARIANT[evt.status] || "default"} className="text-[10px] shrink-0">
                            {evt.status}
                          </Badge>
                        </div>
                        <div className="mt-1 text-xs text-muted-foreground space-y-0.5">
                          {evt.account_name && <div>{evt.account_name}</div>}
                          <div className="flex items-center gap-2">
                            <span>{evt.guest_count} guests</span>
                            {evt.product_name && (
                              <span className="text-muted-foreground/60">{evt.product_name}</span>
                            )}
                          </div>
                        </div>
                      </Link>
                    ))}
                  </div>
                ) : (
                  <p className="text-sm text-muted-foreground">
                    No events on this date.
                  </p>
                )}
              </CardContent>
            </Card>
          </div>
        )}
      </div>

      {isLoading && (
        <p className="text-sm text-muted-foreground">Loading calendar...</p>
      )}
    </div>
  );
}
