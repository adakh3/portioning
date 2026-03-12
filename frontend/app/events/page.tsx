"use client";

import { Suspense, useState } from "react";
import Link from "next/link";
import { EventData } from "@/lib/api";
import { useEvents } from "@/lib/hooks";
import { useQueryState } from "@/lib/useQueryState";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";

const statusBadgeVariant: Record<string, "warning" | "info" | "secondary" | "success" | "destructive"> = {
  tentative: "warning",
  confirmed: "info",
  in_progress: "secondary",
  completed: "success",
  cancelled: "destructive",
};

export default function EventsPage() {
  return (
    <Suspense>
      <EventsContent />
    </Suspense>
  );
}

function EventsContent() {
  const [statusFilter, setStatusFilter] = useQueryState("status", "");
  const [search, setSearch] = useState("");
  const { data: events = [], error, isLoading: loading } = useEvents(statusFilter ? { status: statusFilter } : undefined);

  const statuses = ["", "tentative", "confirmed", "in_progress", "completed", "cancelled"];
  const statusLabels: Record<string, string> = {
    "": "All",
    tentative: "Tentative",
    confirmed: "Confirmed",
    in_progress: "In Progress",
    completed: "Completed",
    cancelled: "Cancelled",
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold text-foreground">Events</h1>
        <Button asChild>
          <Link href="/events/new">New Event</Link>
        </Button>
      </div>

      <div className="flex flex-wrap items-end gap-2">
        <Input
          type="text"
          placeholder="Search..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="w-48"
        />
      </div>

      {/* Status filter tabs */}
      <div className="flex gap-1 border-b border-border">
        {statuses.map((s) => (
          <button
            key={s}
            onClick={() => setStatusFilter(s)}
            className={`px-3 py-2 text-sm font-medium border-b-2 transition-colors ${
              statusFilter === s
                ? "border-primary text-primary"
                : "border-transparent text-muted-foreground hover:text-foreground"
            }`}
          >
            {statusLabels[s]}
          </button>
        ))}
      </div>

      {loading && <p className="text-muted-foreground">Loading events...</p>}
      {error && (
        <div className="bg-destructive/10 border border-destructive/20 text-destructive px-4 py-3 rounded">
          <span>{error.message}</span>
        </div>
      )}

      {(() => {
        const s = search.toLowerCase();
        const filtered = search
          ? events.filter((e) =>
              e.name?.toLowerCase().includes(s) ||
              e.account_name?.toLowerCase().includes(s) ||
              e.contact_name?.toLowerCase().includes(s) ||
              e.venue_name?.toLowerCase().includes(s) ||
              e.venue_address?.toLowerCase().includes(s) ||
              e.date?.includes(s)
            )
          : events;

      return <>
      {!loading && filtered.length === 0 && (
        <p className="text-muted-foreground">
          No events yet. Click &quot;New Event&quot; to create one, or accept a quote.
        </p>
      )}

      <div className="space-y-4">
        {filtered.map((event) => (
          <Card
            key={event.id}
            className="hover:border-border/80 transition-colors"
          >
            <CardContent className="p-5">
              <div className="flex items-start justify-between">
                <div className="flex-1">
                  <div className="flex items-center gap-3">
                    <Link
                      href={`/events/${event.id}`}
                      className="font-semibold text-foreground hover:text-primary transition-colors"
                    >
                      {event.name}
                    </Link>
                    {event.status && (
                      <Badge variant={statusBadgeVariant[event.status] || "secondary"} className="rounded-full">
                        {event.status_display || event.status}
                      </Badge>
                    )}
                  </div>
                  <div className="flex items-center gap-4 mt-1 text-sm text-muted-foreground">
                    <span>{event.date}</span>
                    <span>{event.gents}G / {event.ladies}L</span>
                    {event.big_eaters && <span>big eaters +{event.big_eaters_percentage}%</span>}
                    <span>{event.dishes.length} dishes</span>
                  </div>
                  <div className="flex items-center gap-4 mt-1 text-sm text-muted-foreground">
                    {event.account_name && (
                      <span>Customer: {event.account_name}</span>
                    )}
                    {(event.venue_name || event.venue_address) && (
                      <span>Venue: {event.venue_name || event.venue_address.slice(0, 40)}</span>
                    )}
                    {event.guaranteed_count != null && (
                      <span>Guaranteed: {event.guaranteed_count}</span>
                    )}
                  </div>
                  {event.notes && (
                    <p className="text-sm text-muted-foreground mt-1">{event.notes}</p>
                  )}
                </div>
                <div className="flex gap-2 ml-4">
                  <Button variant="outline" size="sm" asChild>
                    <Link href={`/events/${event.id}`}>Details</Link>
                  </Button>
                  {event.status !== "completed" && event.status !== "cancelled" && (
                    <Button size="sm" asChild>
                      <Link href={`/events/${event.id}?edit=true`}>Edit Event</Link>
                    </Button>
                  )}
                </div>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>
      </>;
      })()}
    </div>
  );
}
