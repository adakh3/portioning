"use client";

import { Suspense, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useQuotes, useSiteSettings, useDateFormat, useUsers, useProductLines, useEventTypes } from "@/lib/hooks";
import { formatDate } from "@/lib/dateFormat";
import { formatCurrency, cn } from "@/lib/utils";
import { statusColor } from "@/lib/statusColors";
import { useQueryState } from "@/lib/useQueryState";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Avatar } from "@/components/ui/avatar";

const STATUSES = ["all", "draft", "sent", "accepted", "expired", "declined"];

// Quote statuses are fixed → tinted pills (same look as the leads status pills).
const QUOTE_STATUS_COLOR: Record<string, string> = {
  draft: "gray", sent: "blue", accepted: "green", expired: "amber", declined: "red",
};

type SortField = "customer" | "salesperson" | "event_date" | "guest_count" | "total" | "created_at";
const SORT_COLUMNS: { field: SortField; label: string; align?: "right" }[] = [
  { field: "customer", label: "Customer" },
  { field: "salesperson", label: "Salesperson" },
  { field: "event_date", label: "Event Date" },
  { field: "guest_count", label: "Guests" },
  { field: "total", label: "Total", align: "right" },
  { field: "created_at", label: "Created" },
];

export default function QuotesPage() {
  return (
    <Suspense>
      <QuotesContent />
    </Suspense>
  );
}

function QuotesContent() {
  const router = useRouter();
  const [filter, setFilter] = useQueryState("status", "all");
  const [search, setSearch] = useState("");
  const [fSalesperson, setFSalesperson] = useState("");
  const [fProduct, setFProduct] = useState("");
  const [fEventType, setFEventType] = useState("");
  const [fDateFrom, setFDateFrom] = useState("");
  const [fDateTo, setFDateTo] = useState("");
  const [sortField, setSortField] = useState<SortField>("created_at");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("desc");

  const { data: quotes = [], error: loadError, isLoading: loading } = useQuotes(filter);
  const { data: rawSettings } = useSiteSettings();
  const settings = rawSettings || { currency_symbol: "£", currency_code: "GBP", date_format: "DD/MM/YYYY", default_price_per_head: "0.00", target_food_cost_percentage: "30.00", price_rounding_step: "50" };
  const dateFormat = useDateFormat();
  const { data: users = [] } = useUsers();
  const { data: productLines = [] } = useProductLines();
  const { data: eventTypes = [] } = useEventTypes();

  function toggleSort(f: SortField) {
    if (sortField === f) setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    else { setSortField(f); setSortDir(f === "customer" || f === "salesperson" ? "asc" : "desc"); }
  }

  if (loadError) return <p className="text-destructive">Error: {loadError.message}</p>;

  const customerOf = (q: typeof quotes[number]) => q.contact_name || q.account_name || "";
  const s = search.toLowerCase();
  const filtered = quotes.filter((q) => {
    if (search && !(
      q.account_name?.toLowerCase().includes(s) ||
      q.contact_name?.toLowerCase().includes(s) ||
      q.contact_email?.toLowerCase().includes(s) ||
      q.contact_phone?.toLowerCase().includes(s) ||
      q.venue_name?.toLowerCase().includes(s) ||
      q.assigned_to_name?.toLowerCase().includes(s) ||
      `${q.id}`.includes(s)
    )) return false;
    if (fSalesperson && String(q.assigned_to) !== fSalesperson) return false;
    if (fProduct && String(q.product) !== fProduct) return false;
    if (fEventType && q.event_type !== fEventType) return false;
    if (fDateFrom && (!q.event_date || q.event_date < fDateFrom)) return false;
    if (fDateTo && (!q.event_date || q.event_date > fDateTo)) return false;
    return true;
  });

  const sorted = [...filtered].sort((a, b) => {
    let av: string | number = "", bv: string | number = "";
    switch (sortField) {
      case "customer": av = customerOf(a).toLowerCase(); bv = customerOf(b).toLowerCase(); break;
      case "salesperson": av = (a.assigned_to_name || "").toLowerCase(); bv = (b.assigned_to_name || "").toLowerCase(); break;
      case "event_date": av = a.event_date || ""; bv = b.event_date || ""; break;
      case "guest_count": av = a.guest_count || 0; bv = b.guest_count || 0; break;
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
        <h1 className="text-2xl font-bold text-foreground">Quotes</h1>
        <Button asChild>
          <Link href="/quotes/new">New Quote</Link>
        </Button>
      </div>

      <div className="flex flex-wrap items-end gap-2 mb-4">
        <Input
          type="text"
          placeholder="Search customer, venue, salesperson, #..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="w-64"
        />
        <Select value={fSalesperson || "__all__"} onValueChange={(v) => setFSalesperson(v === "__all__" ? "" : v)}>
          <SelectTrigger className="w-40"><SelectValue placeholder="Salesperson" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="__all__">All Salespeople</SelectItem>
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
            className={filter === st ? "bg-foreground text-background hover:bg-foreground/90" : "capitalize"}
          >
            <span className="capitalize">{st}</span>
          </Button>
        ))}
      </div>

      {loading ? (
        <p className="text-muted-foreground">Loading quotes...</p>
      ) : sorted.length === 0 ? (
        <p className="text-muted-foreground">No quotes found.</p>
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
                  <TableHead className="whitespace-nowrap text-muted-foreground">Quote</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {sorted.map((q) => (
                  <TableRow key={q.id} className="cursor-pointer" onClick={() => router.push(`/quotes/${q.id}`)}>
                    <TableCell className="font-medium">{customerOf(q) || "—"}</TableCell>
                    <TableCell className="whitespace-nowrap text-muted-foreground">
                      <span className="inline-flex items-center gap-2">
                        <Avatar name={q.assigned_to_name} />
                        {q.assigned_to_name || "—"}
                      </span>
                    </TableCell>
                    <TableCell className="whitespace-nowrap">{q.event_date ? formatDate(q.event_date, dateFormat) : "—"}</TableCell>
                    <TableCell>{q.guest_count}</TableCell>
                    <TableCell className="text-right font-medium whitespace-nowrap">{formatCurrency(q.total, settings.currency_symbol)}</TableCell>
                    <TableCell className="whitespace-nowrap text-muted-foreground text-xs">{formatDate(q.created_at, dateFormat)}</TableCell>
                    <TableCell>
                      <span className={cn("inline-block rounded-full px-2.5 py-0.5 text-xs font-medium uppercase tracking-wide", statusColor(QUOTE_STATUS_COLOR[q.status]).pill)}>
                        {q.status_display}
                      </span>
                    </TableCell>
                    <TableCell className="whitespace-nowrap text-muted-foreground text-xs">#{q.id} · v{q.version}</TableCell>
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
