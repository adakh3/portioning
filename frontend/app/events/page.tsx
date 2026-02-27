"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { api, EventData, CalculationResult } from "@/lib/api";
import ResultsTable from "@/components/ResultsTable";
import WarningsBanner from "@/components/WarningsBanner";

const statusColors: Record<string, string> = {
  tentative: "bg-yellow-100 text-yellow-800",
  confirmed: "bg-blue-100 text-blue-800",
  in_progress: "bg-orange-100 text-orange-800",
  completed: "bg-green-100 text-green-800",
  cancelled: "bg-red-100 text-red-800",
};

export default function EventsPage() {
  const [events, setEvents] = useState<EventData[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [calcResult, setCalcResult] = useState<{ id: number; result: CalculationResult } | null>(null);
  const [calcLoading, setCalcLoading] = useState(false);
  const [exportingId, setExportingId] = useState<number | null>(null);
  const [statusFilter, setStatusFilter] = useState<string>("");
  const router = useRouter();

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

  const calculateEvent = async (id: number) => {
    setCalcLoading(true);
    try {
      const res = await api.calculateEvent(id);
      setCalcResult({ id, result: res });
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Calculation failed");
    } finally {
      setCalcLoading(false);
    }
  };

  const handleExportPDF = async (event: EventData) => {
    setExportingId(event.id);
    try {
      const blob = await api.exportPDF({
        dish_ids: event.dishes,
        guests: { gents: event.gents, ladies: event.ladies },
        big_eaters: event.big_eaters,
        big_eaters_percentage: event.big_eaters_percentage,
        menu_name: event.name,
        date: event.date,
        constraint_overrides: event.constraint_override ?? undefined,
      });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `${event.name.replace(/\s+/g, "-").toLowerCase()}-portioning.pdf`;
      a.click();
      URL.revokeObjectURL(url);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "PDF export failed");
    } finally {
      setExportingId(null);
    }
  };

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
        <h1 className="text-2xl font-bold text-gray-900">Events</h1>
        <Link href="/events/new" className="bg-blue-600 text-white px-4 py-2 rounded text-sm hover:bg-blue-700">
          New Event
        </Link>
      </div>

      {/* Status filter tabs */}
      <div className="flex gap-1 border-b border-gray-200">
        {statuses.map((s) => (
          <button
            key={s}
            onClick={() => setStatusFilter(s)}
            className={`px-3 py-2 text-sm font-medium border-b-2 transition-colors ${
              statusFilter === s
                ? "border-blue-600 text-blue-600"
                : "border-transparent text-gray-500 hover:text-gray-700"
            }`}
          >
            {statusLabels[s]}
          </button>
        ))}
      </div>

      {loading && <p className="text-gray-500">Loading events...</p>}
      {error && (
        <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded flex justify-between">
          <span>{error}</span>
          <button onClick={() => setError(null)} className="text-red-500 hover:text-red-700">&times;</button>
        </div>
      )}

      {!loading && events.length === 0 && (
        <p className="text-gray-500">
          No events yet. Click &quot;New Event&quot; to create one, or accept a quote.
        </p>
      )}

      <div className="space-y-4">
        {events.map((event) => (
          <div
            key={event.id}
            className="bg-white border border-gray-200 rounded-lg p-5 hover:border-gray-300 transition-colors"
          >
            <div className="flex items-start justify-between">
              <div className="flex-1">
                <div className="flex items-center gap-3">
                  <Link
                    href={`/events/${event.id}`}
                    className="font-semibold text-gray-900 hover:text-blue-600 transition-colors"
                  >
                    {event.name}
                  </Link>
                  {event.status && (
                    <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${statusColors[event.status] || "bg-gray-100 text-gray-800"}`}>
                      {event.status_display || event.status}
                    </span>
                  )}
                </div>
                <div className="flex items-center gap-4 mt-1 text-sm text-gray-500">
                  <span>{event.date}</span>
                  <span>{event.gents}G / {event.ladies}L</span>
                  {event.big_eaters && <span>big eaters +{event.big_eaters_percentage}%</span>}
                  <span>{event.dishes.length} dishes</span>
                </div>
                <div className="flex items-center gap-4 mt-1 text-sm text-gray-500">
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
                  <p className="text-sm text-gray-600 mt-1">{event.notes}</p>
                )}
              </div>
              <div className="flex gap-2 ml-4">
                <Link
                  href={`/events/${event.id}`}
                  className="border border-gray-300 text-gray-700 bg-white px-3 py-1.5 rounded text-sm font-medium hover:bg-gray-50 transition-colors"
                >
                  Details
                </Link>
                <button
                  onClick={() => router.push(`/calculate?event=${event.id}`)}
                  className="border border-gray-300 text-gray-700 bg-white px-3 py-1.5 rounded text-sm font-medium hover:bg-gray-50 transition-colors"
                >
                  Edit Menu
                </button>
                <button
                  onClick={() => calculateEvent(event.id)}
                  disabled={calcLoading}
                  className="bg-blue-600 text-white px-3 py-1.5 rounded text-sm font-medium hover:bg-blue-700 disabled:opacity-50 transition-colors"
                >
                  {calcLoading && calcResult?.id === event.id ? "Calculating..." : "Calculate"}
                </button>
                <button
                  onClick={() => handleExportPDF(event)}
                  disabled={exportingId === event.id}
                  className="bg-green-600 text-white px-3 py-1.5 rounded text-sm font-medium hover:bg-green-700 disabled:opacity-50 transition-colors"
                >
                  {exportingId === event.id ? "Exporting..." : "PDF"}
                </button>
              </div>
            </div>

            {calcResult?.id === event.id && (
              <div className="mt-4 space-y-3">
                <WarningsBanner
                  warnings={calcResult.result.warnings}
                  adjustments={calcResult.result.adjustments_applied}
                />
                <ResultsTable result={calcResult.result} />
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
