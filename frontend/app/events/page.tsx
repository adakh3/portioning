"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { api, EventData } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";

const statusBadgeVariant: Record<string, "warning" | "info" | "secondary" | "success" | "destructive"> = {
  tentative: "warning",
  confirmed: "info",
  in_progress: "secondary",
  completed: "success",
  cancelled: "destructive",
};

export default function EventsPage() {
  const [events, setEvents] = useState<EventData[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [statusFilter, setStatusFilter] = useState<string>("");

  const loadEvents = () => {
    setLoading(true);
    api.getEvents(statusFilter ? { status: statusFilter } : undefined)
      .then(setEvents)
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    loadEvents();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [statusFilter]);

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
        <div className="bg-destructive/10 border border-destructive/20 text-destructive px-4 py-3 rounded flex justify-between">
          <span>{error}</span>
          <button onClick={() => setError(null)} className="text-destructive/80 hover:text-destructive">&times;</button>
        </div>
      )}

      {!loading && events.length === 0 && (
        <p className="text-muted-foreground">
          No events yet. Click &quot;New Event&quot; to create one, or accept a quote.
        </p>
      )}

      <div className="space-y-4">
        {events.map((event) => (
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
                      <Link href={`/events/${event.id}`}>Edit Event</Link>
                    </Button>
                  )}
                </div>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  );
}
