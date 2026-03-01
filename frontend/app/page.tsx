"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { api, EventData, Quote, Lead } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";

export default function Dashboard() {
  const [events, setEvents] = useState<EventData[]>([]);
  const [quotes, setQuotes] = useState<Quote[]>([]);
  const [leads, setLeads] = useState<Lead[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    Promise.all([
      api.getEvents({ date_from: new Date().toISOString().split("T")[0] }),
      api.getQuotes(),
      api.getLeads(),
    ])
      .then(([e, q, l]) => {
        setEvents(e.slice(0, 5));
        setQuotes(q.filter((q) => q.status === "draft" || q.status === "sent").slice(0, 5));
        setLeads(l.slice(0, 5));
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  if (loading) {
    return <p className="text-muted-foreground">Loading dashboard...</p>;
  }

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-2xl font-bold text-foreground">Dashboard</h1>
        <p className="text-muted-foreground mt-1">Overview of your catering operations</p>
      </div>

      {/* Quick Actions */}
      <div className="flex flex-wrap gap-3">
        <Button asChild>
          <Link href="/leads/new">New Lead</Link>
        </Button>
        <Button asChild>
          <Link href="/quotes/new">New Quote</Link>
        </Button>
        <Button asChild>
          <Link href="/events/new">New Event</Link>
        </Button>
        <Button asChild variant="secondary">
          <Link href="/calculate">Portioning Calculator</Link>
        </Button>
      </div>

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
                      <span>{ev.date}</span>
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
                      <span>{q.event_date}</span>
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
                          <span>{l.event_date}</span>
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
