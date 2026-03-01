"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { api, EventData, Quote, Lead } from "@/lib/api";

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
    return <p className="text-gray-500">Loading dashboard...</p>;
  }

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-2xl font-bold text-gray-900">Dashboard</h1>
        <p className="text-gray-500 mt-1">Overview of your catering operations</p>
      </div>

      {/* Quick Actions */}
      <div className="flex flex-wrap gap-3">
        <Link href="/leads/new" className="bg-blue-600 text-white px-4 py-2 rounded-lg text-sm font-medium hover:bg-blue-700 transition-colors">
          New Lead
        </Link>
        <Link href="/quotes/new" className="bg-blue-600 text-white px-4 py-2 rounded-lg text-sm font-medium hover:bg-blue-700 transition-colors">
          New Quote
        </Link>
        <Link href="/events/new" className="bg-blue-600 text-white px-4 py-2 rounded-lg text-sm font-medium hover:bg-blue-700 transition-colors">
          New Event
        </Link>
        <Link href="/calculate" className="bg-gray-800 text-white px-4 py-2 rounded-lg text-sm font-medium hover:bg-gray-900 transition-colors">
          Portioning Calculator
        </Link>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Upcoming Events */}
        <DashboardCard title="Upcoming Events" viewAllHref="/events">
          {events.length === 0 ? (
            <p className="text-sm text-gray-400">No upcoming events</p>
          ) : (
            <ul className="space-y-3">
              {events.map((ev) => (
                <li key={ev.id}>
                  <Link href={`/events/${ev.id}`} className="block hover:bg-gray-50 -mx-1 px-1 py-1 rounded transition-colors">
                    <p className="text-sm font-medium text-gray-900 truncate">{ev.name}</p>
                    <div className="flex items-center gap-2 text-xs text-gray-500">
                      <span>{ev.date}</span>
                      <span className="text-gray-300">|</span>
                      <span>{ev.gents + ev.ladies} guests</span>
                      <StatusBadge status={ev.status_display} />
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
            <p className="text-sm text-gray-400">No pending quotes</p>
          ) : (
            <ul className="space-y-3">
              {quotes.map((q) => (
                <li key={q.id}>
                  <Link href={`/quotes/${q.id}`} className="block hover:bg-gray-50 -mx-1 px-1 py-1 rounded transition-colors">
                    <p className="text-sm font-medium text-gray-900 truncate">
                      {q.account_name || "No account"}
                    </p>
                    <div className="flex items-center gap-2 text-xs text-gray-500">
                      <span>{q.event_date}</span>
                      <span className="text-gray-300">|</span>
                      <span>{q.guest_count} guests</span>
                      <StatusBadge status={q.status_display} />
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
            <p className="text-sm text-gray-400">No leads yet</p>
          ) : (
            <ul className="space-y-3">
              {leads.map((l) => (
                <li key={l.id}>
                  <Link href={`/leads/${l.id}`} className="block hover:bg-gray-50 -mx-1 px-1 py-1 rounded transition-colors">
                    <p className="text-sm font-medium text-gray-900 truncate">{l.contact_name}</p>
                    <div className="flex items-center gap-2 text-xs text-gray-500">
                      <span>{l.event_type_display}</span>
                      {l.event_date && (
                        <>
                          <span className="text-gray-300">|</span>
                          <span>{l.event_date}</span>
                        </>
                      )}
                      <StatusBadge status={l.status_display} />
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
    <div className="bg-white border border-gray-200 rounded-lg p-5">
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-sm font-semibold text-gray-900">{title}</h2>
        <Link href={viewAllHref} className="text-xs text-blue-600 hover:text-blue-800">
          View all &rarr;
        </Link>
      </div>
      {children}
    </div>
  );
}

function StatusBadge({ status }: { status: string }) {
  return (
    <span className="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-medium bg-gray-100 text-gray-600">
      {status}
    </span>
  );
}
