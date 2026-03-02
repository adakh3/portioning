"use client";

import Link from "next/link";
import { useEvents } from "@/lib/hooks";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { useState } from "react";

const statusBadgeVariant: Record<string, "warning" | "info" | "secondary" | "success" | "destructive"> = {
  confirmed: "info",
  in_progress: "secondary",
  completed: "success",
};

const serviceStyleLabels: Record<string, string> = {
  buffet: "Buffet",
  plated: "Plated",
  stations: "Food Stations",
  family_style: "Family Style",
  boxed: "Boxed",
  canapes: "Canapés",
  mixed: "Mixed",
};

export default function KitchenEventsPage() {
  const [statusFilter, setStatusFilter] = useState<string>("confirmed");
  const { data: events = [], error, isLoading } = useEvents(
    statusFilter ? { status: statusFilter } : undefined
  );

  const statuses = ["", "confirmed", "in_progress", "completed"];
  const statusLabels: Record<string, string> = {
    "": "All",
    confirmed: "Confirmed",
    in_progress: "In Progress",
    completed: "Completed",
  };

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold text-foreground">Kitchen Events</h1>

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

      {isLoading && <p className="text-muted-foreground">Loading events...</p>}
      {error && (
        <div className="bg-destructive/10 border border-destructive/20 text-destructive px-4 py-3 rounded">
          {error.message}
        </div>
      )}

      {!isLoading && events.length === 0 && (
        <p className="text-muted-foreground">No events found for this filter.</p>
      )}

      <div className="space-y-4">
        {events.map((event) => (
          <Card key={event.id} className="hover:border-border/80 transition-colors">
            <CardContent className="p-5">
              <div className="flex items-start justify-between">
                <div className="flex-1">
                  <div className="flex items-center gap-3">
                    <Link
                      href={`/kitchen/events/${event.id}`}
                      className="font-semibold text-foreground hover:text-primary transition-colors"
                    >
                      {event.name}
                    </Link>
                    {event.status && (
                      <Badge
                        variant={statusBadgeVariant[event.status] || "secondary"}
                        className="rounded-full"
                      >
                        {event.status_display || event.status}
                      </Badge>
                    )}
                  </div>
                  <div className="flex items-center gap-4 mt-1 text-sm text-muted-foreground">
                    <span>{event.date}</span>
                    <span>
                      {event.gents + event.ladies} guests ({event.gents}G / {event.ladies}L)
                    </span>
                    {event.service_style && (
                      <span>{serviceStyleLabels[event.service_style] || event.service_style}</span>
                    )}
                    <span>{event.dishes.length} dishes</span>
                  </div>
                  <div className="flex items-center gap-4 mt-1 text-sm text-muted-foreground">
                    {event.account_name && <span>{event.account_name}</span>}
                    {(event.venue_name || event.venue_address) && (
                      <span>{event.venue_name || event.venue_address.slice(0, 40)}</span>
                    )}
                  </div>
                </div>
                <Button variant="outline" size="sm" asChild>
                  <Link href={`/kitchen/events/${event.id}`}>View Portions</Link>
                </Button>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  );
}
