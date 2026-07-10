"use client";

import { Suspense, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEvents, useSiteSettings, useDateFormat, useUsers, useProductLines, useEventTypes } from "@/lib/hooks";
import { formatDate } from "@/lib/dateFormat";
import { formatCurrency, cn } from "@/lib/utils";
import { statusColor } from "@/lib/statusColors";
import { useQueryState } from "@/lib/useQueryState";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";

const STATUSES = ["all", "tentative", "confirmed", "in_progress", "completed", "cancelled"];

const STATUS_LABEL: Record<string, string> = {
  all: "All", tentative: "Tentative", confirmed: "Confirmed",
  in_progress: "In Progress", completed: "Completed", cancelled: "Cancelled",
};

// Event statuses are fixed → tinted pills (same look as quotes/leads status pills).
const EVENT_STATUS_COLOR: Record<string, string> = {
  tentative: "amber", confirmed: "blue", in_progress: "indigo", completed: "green", cancelled: "gray",
};

type SortField = "name" | "customer" | "salesperson" | "date" | "guests" | "total" | "created_at";
const SORT_COLUMNS: { field: SortField; label: string; align?: "right" }[] = [
  { field: "name", label: "Event" },
  { field: "customer", label: "Customer" },
  { field: "salesperson", label: "Salesperson" },
  { field: "date", label: "Event Date" },
  { field: "guests", label: "Guests", align: "right" },
  { field: "total", label: "Total", align: "right" },
  { field: "created_at", label: "Created" },
];

export default function EventsPage() {
  return (
    <Suspense>
      <EventsContent />
    </Suspense>
  );
}

function EventsContent() {
  const router = useRouter();
  const [filter, setFilter] = useQueryState("status", "all");
  const [search, setSearch] = useState("");
  const [fAssignedTo, setFAssignedTo] = useState("");
  const [fCreatedBy, setFCreatedBy] = useState("");
  const [fProduct, setFProduct] = useState("");
  const [fEventType, setFEventType] = useState("");
  const [fDateFrom, setFDateFrom] = useState("");
  const [fDateTo, setFDateTo] = useState("");
  const [sortField, setSortField] = useState<SortField>("date");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("desc");

  const { data: events = [], error: loadError, isLoading: loading } = useEvents(filter !== "all" ? { status: filter } : undefined);
  const { data: rawSettings } = useSiteSettings();
  const cs = rawSettings?.currency_symbol || "£";
  const dateFormat = useDateFormat();
  const { data: users = [] } = useUsers();
  const { data: productLines = [] } = useProductLines();
  const { data: eventTypes = [] } = useEventTypes();

  function toggleSort(f: SortField) {
    if (sortField === f) setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    else { setSortField(f); setSortDir(f === "name" || f === "customer" || f === "salesperson" ? "asc" : "desc"); }
  }

  if (loadError) return <p className="text-destructive">Error: {loadError.message}</p>;

  const customerOf = (e: typeof events[number]) => e.contact_name || e.account_name || "";
  const guestsOf = (e: typeof events[number]) => (e.gents || 0) + (e.ladies || 0);
  const s = search.toLowerCase();
  const filtered = events.filter((e) => {
    if (search && !(
      e.name?.toLowerCase().includes(s) ||
      e.account_name?.toLowerCase().includes(s) ||
      e.contact_name?.toLowerCase().includes(s) ||
      e.assigned_to_name?.toLowerCase().includes(s) ||
      e.created_by_name?.toLowerCase().includes(s) ||
      e.venue_name?.toLowerCase().includes(s) ||
      e.venue_address?.toLowerCase().includes(s) ||
      e.date?.includes(s)
    )) return false;
    if (fAssignedTo && String(e.assigned_to) !== fAssignedTo) return false;
    if (fCreatedBy && String(e.created_by) !== fCreatedBy) return false;
    if (fProduct && String(e.product) !== fProduct) return false;
    if (fEventType && e.event_type !== fEventType) return false;
    if (fDateFrom && (!e.date || e.date < fDateFrom)) return false;
    if (fDateTo && (!e.date || e.date > fDateTo)) return false;
    return true;
  });

  const sorted = [...filtered].sort((a, b) => {
    let av: string | number = "", bv: string | number = "";
    switch (sortField) {
      case "name": av = (a.name || "").toLowerCase(); bv = (b.name || "").toLowerCase(); break;
      case "customer": av = customerOf(a).toLowerCase(); bv = customerOf(b).toLowerCase(); break;
      case "salesperson": av = (a.assigned_to_name || "").toLowerCase(); bv = (b.assigned_to_name || "").toLowerCase(); break;
      case "date": av = a.date || ""; bv = b.date || ""; break;
      case "guests": av = guestsOf(a); bv = guestsOf(b); break;
      case "total": av = Number(a.total) || 0; bv = Number(b.total) || 0; break;
      case "created_at": av = a.created_at || ""; bv = b.created_at || ""; break;
    }
    if (av < bv) return sortDir === "asc" ? -1 : 1;
    if (av > bv) return sortDir === "asc" ? 1 : -1;
    return 0;
  });

  const arrow = (f: SortField) => (sortField === f ? (sortDir === "asc" ? " ↑" : " ↓") : "");

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-2xl font-bold text-foreground">Events</h1>
        <Button asChild>
          <Link href="/events/new">New Event</Link>
        </Button>
      </div>

      <div className="flex flex-wrap items-end gap-2 mb-4">
        <Input
          type="text"
          placeholder="Search event, customer, venue, salesperson..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="w-64"
        />
        <Select value={fAssignedTo || "__all__"} onValueChange={(v) => setFAssignedTo(v === "__all__" ? "" : v)}>
          <SelectTrigger className="w-40"><SelectValue placeholder="Assigned to" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="__all__">Assigned to: All</SelectItem>
            {users.map((u) => <SelectItem key={u.id} value={String(u.id)}>{u.first_name} {u.last_name}</SelectItem>)}
          </SelectContent>
        </Select>
        <Select value={fCreatedBy || "__all__"} onValueChange={(v) => setFCreatedBy(v === "__all__" ? "" : v)}>
          <SelectTrigger className="w-40"><SelectValue placeholder="Created by" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="__all__">Created by: All</SelectItem>
            {users.map((u) => <SelectItem key={u.id} value={String(u.id)}>{u.first_name} {u.last_name}</SelectItem>)}
          </SelectContent>
        </Select>
        <Select value={fProduct || "__all__"} onValueChange={(v) => setFProduct(v === "__all__" ? "" : v)}>
          <SelectTrigger className="w-40"><SelectValue placeholder="Product" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="__all__">All Products</SelectItem>
            {productLines.map((p) => <SelectItem key={p.id} value={String(p.id)}>{p.name}</SelectItem>)}
          </SelectContent>
        </Select>
        <Select value={fEventType || "__all__"} onValueChange={(v) => setFEventType(v === "__all__" ? "" : v)}>
          <SelectTrigger className="w-40"><SelectValue placeholder="Event Type" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="__all__">All Types</SelectItem>
            {eventTypes.map((et) => <SelectItem key={et.value} value={et.value}>{et.label}</SelectItem>)}
          </SelectContent>
        </Select>
        <Input type="date" value={fDateFrom} onChange={(e) => setFDateFrom(e.target.value)} className="w-36" title="Event date from" />
        <Input type="date" value={fDateTo} onChange={(e) => setFDateTo(e.target.value)} className="w-36" title="Event date to" />
      </div>

      <div className="flex gap-2 overflow-x-auto mb-4">
        {STATUSES.map((st) => (
          <Button
            key={st}
            variant={filter === st ? "default" : "outline"}
            size="sm"
            onClick={() => setFilter(st)}
            className={filter === st ? "bg-foreground text-background hover:bg-foreground/90" : ""}
          >
            {STATUS_LABEL[st]}
          </Button>
        ))}
      </div>

      {loading ? (
        <p className="text-muted-foreground">Loading events...</p>
      ) : sorted.length === 0 ? (
        <p className="text-muted-foreground">No events found. Click &quot;New Event&quot; to create one, or accept a quote.</p>
      ) : (
        <Card>
          <CardContent className="p-0">
            <Table>
              <TableHeader>
                <TableRow>
                  {SORT_COLUMNS.map((c) => (
                    <TableHead
                      key={c.field}
                      onClick={() => toggleSort(c.field)}
                      className={`cursor-pointer select-none whitespace-nowrap ${c.align === "right" ? "text-right" : ""}`}
                    >
                      {c.label}{arrow(c.field)}
                    </TableHead>
                  ))}
                  <TableHead className="whitespace-nowrap">Status</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {sorted.map((e) => (
                  <TableRow key={e.id} className="cursor-pointer" onClick={() => router.push(`/events/${e.id}`)}>
                    <TableCell className="font-medium">{e.name || "—"}</TableCell>
                    <TableCell className="whitespace-nowrap">{customerOf(e) || "—"}</TableCell>
                    <TableCell className="whitespace-nowrap text-muted-foreground">{e.assigned_to_name || "—"}</TableCell>
                    <TableCell className="whitespace-nowrap">{e.date ? formatDate(e.date, dateFormat) : "—"}</TableCell>
                    <TableCell className="text-right">{guestsOf(e)}</TableCell>
                    <TableCell className="text-right font-medium whitespace-nowrap">{formatCurrency(e.total, cs)}</TableCell>
                    <TableCell className="whitespace-nowrap text-muted-foreground text-xs">{formatDate(e.created_at, dateFormat)}</TableCell>
                    <TableCell>
                      <span className={cn("inline-block rounded-full px-2.5 py-0.5 text-xs font-medium uppercase tracking-wide", statusColor(EVENT_STATUS_COLOR[e.status]).pill)}>
                        {e.status_display || e.status}
                      </span>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
