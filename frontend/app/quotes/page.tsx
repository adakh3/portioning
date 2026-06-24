"use client";

import { Suspense, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useQuotes, useSiteSettings, useDateFormat } from "@/lib/hooks";
import { formatDate } from "@/lib/dateFormat";
import { formatCurrency } from "@/lib/utils";
import { useQueryState } from "@/lib/useQueryState";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";

const STATUS_BADGE_VARIANT: Record<string, "secondary" | "info" | "success" | "warning" | "destructive"> = {
  draft: "secondary",
  sent: "info",
  accepted: "success",
  expired: "warning",
  declined: "destructive",
};

const STATUSES = ["all", "draft", "sent", "accepted", "expired", "declined"];

type SortField = "customer" | "event_date" | "guest_count" | "total" | "created_at";
const SORT_COLUMNS: { field: SortField; label: string; align?: "right" }[] = [
  { field: "customer", label: "Customer" },
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
  const [sortField, setSortField] = useState<SortField>("created_at");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("desc");
  const { data: quotes = [], error: loadError, isLoading: loading } = useQuotes(filter);
  const { data: rawSettings } = useSiteSettings();
  const settings = rawSettings || { currency_symbol: "£", currency_code: "GBP", date_format: "DD/MM/YYYY", default_price_per_head: "0.00", target_food_cost_percentage: "30.00", price_rounding_step: "50" };
  const dateFormat = useDateFormat();

  function toggleSort(f: SortField) {
    if (sortField === f) setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    else { setSortField(f); setSortDir(f === "customer" ? "asc" : "desc"); }
  }

  if (loadError) return <p className="text-destructive">Error: {loadError.message}</p>;

  const customerOf = (q: typeof quotes[number]) => q.contact_name || q.account_name || "";
  const s = search.toLowerCase();
  const filtered = search
    ? quotes.filter((q) =>
        q.account_name?.toLowerCase().includes(s) ||
        q.contact_name?.toLowerCase().includes(s) ||
        q.contact_email?.toLowerCase().includes(s) ||
        q.contact_phone?.toLowerCase().includes(s) ||
        q.venue_name?.toLowerCase().includes(s) ||
        `${q.id}`.includes(s)
      )
    : quotes;

  const sorted = [...filtered].sort((a, b) => {
    let av: string | number = "", bv: string | number = "";
    switch (sortField) {
      case "customer": av = customerOf(a).toLowerCase(); bv = customerOf(b).toLowerCase(); break;
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
          placeholder="Search customer, venue, #..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="w-56"
        />
        <div className="flex gap-2 overflow-x-auto">
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
                  <TableRow
                    key={q.id}
                    className="cursor-pointer"
                    onClick={() => router.push(`/quotes/${q.id}`)}
                  >
                    <TableCell className="font-medium">{customerOf(q) || "—"}</TableCell>
                    <TableCell className="whitespace-nowrap">{q.event_date ? formatDate(q.event_date, dateFormat) : "—"}</TableCell>
                    <TableCell>{q.guest_count}</TableCell>
                    <TableCell className="text-right font-medium whitespace-nowrap">{formatCurrency(q.total, settings.currency_symbol)}</TableCell>
                    <TableCell className="whitespace-nowrap text-muted-foreground text-xs">{formatDate(q.created_at, dateFormat)}</TableCell>
                    <TableCell>
                      <Badge variant={STATUS_BADGE_VARIANT[q.status] || "secondary"}>{q.status_display}</Badge>
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
