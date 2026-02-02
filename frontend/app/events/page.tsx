"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { api, EventData, CalculationResult } from "@/lib/api";
import ResultsTable from "@/components/ResultsTable";
import WarningsBanner from "@/components/WarningsBanner";

export default function EventsPage() {
  const [events, setEvents] = useState<EventData[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [calcResult, setCalcResult] = useState<{ id: number; result: CalculationResult } | null>(null);
  const [calcLoading, setCalcLoading] = useState(false);
  const [exportingId, setExportingId] = useState<number | null>(null);
  const [expandedComments, setExpandedComments] = useState<Set<number>>(new Set());
  const router = useRouter();

  useEffect(() => {
    api.getEvents()
      .then(setEvents)
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  }, []);

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

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold text-gray-900">Events</h1>

      {loading && <p className="text-gray-500">Loading events...</p>}
      {error && <p className="text-red-600">{error}</p>}

      {!loading && events.length === 0 && (
        <p className="text-gray-500">
          No events yet. Create one from the Calculate page or Django admin.
        </p>
      )}

      <div className="space-y-4">
        {events.map((event) => (
          <div
            key={event.id}
            className="bg-white border border-gray-200 rounded-lg p-5"
          >
            <div className="flex items-start justify-between">
              <div>
                <h3 className="font-semibold text-gray-900">{event.name}</h3>
                <p className="text-sm text-gray-500 mt-1">
                  {event.date} — {event.gents}G / {event.ladies}L
                  {event.big_eaters && ` (big eaters +${event.big_eaters_percentage}%)`}
                  {" "}({event.dishes.length} dishes)
                </p>
                {event.notes && (
                  <p className="text-sm text-gray-600 mt-1">{event.notes}</p>
                )}
              </div>
              <div className="flex gap-2">
                <button
                  onClick={() => router.push(`/calculate?event=${event.id}`)}
                  className="border border-gray-300 text-gray-700 bg-white px-3 py-1.5 rounded text-sm font-medium hover:bg-gray-50 transition-colors"
                >
                  Edit
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
                  {exportingId === event.id ? "Exporting..." : "Export PDF"}
                </button>
              </div>
            </div>

            {event.dish_comments && event.dish_comments.some((dc) => dc.comment) && (
              <div className="mt-3">
                <button
                  type="button"
                  onClick={() =>
                    setExpandedComments((prev) => {
                      const next = new Set(prev);
                      next.has(event.id) ? next.delete(event.id) : next.add(event.id);
                      return next;
                    })
                  }
                  className="text-sm text-blue-600 hover:text-blue-800 font-medium"
                >
                  {expandedComments.has(event.id) ? "Hide" : "Show"} Dish Comments
                  ({event.dish_comments.filter((dc) => dc.comment).length})
                </button>
                {expandedComments.has(event.id) && (
                  <div className="mt-2 space-y-1">
                    {event.dish_comments
                      .filter((dc) => dc.comment)
                      .map((dc) => (
                        <div
                          key={dc.dish_id}
                          className="flex items-baseline gap-2 text-sm"
                        >
                          <span className="font-medium text-gray-700">
                            {dc.dish_name || `Dish #${dc.dish_id}`}
                          </span>
                          {dc.portion_grams != null && (
                            <span className="text-gray-400 text-xs">
                              ({dc.portion_grams}g)
                            </span>
                          )}
                          <span className="text-gray-600">{dc.comment}</span>
                        </div>
                      ))}
                  </div>
                )}
              </div>
            )}

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
