"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { api, Quote, SiteSettingsData } from "@/lib/api";

const STATUS_COLORS: Record<string, string> = {
  draft: "bg-gray-100 text-gray-700",
  sent: "bg-blue-100 text-blue-700",
  accepted: "bg-green-100 text-green-700",
  expired: "bg-yellow-100 text-yellow-700",
  declined: "bg-red-100 text-red-700",
};

const STATUSES = ["all", "draft", "sent", "accepted", "expired", "declined"];

export default function QuotesPage() {
  const [quotes, setQuotes] = useState<Quote[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [filter, setFilter] = useState("all");
  const [settings, setSettings] = useState<SiteSettingsData>({ currency_symbol: "£", currency_code: "GBP", default_price_per_head: "0.00", target_food_cost_percentage: "30.00" });

  function loadQuotes(status?: string) {
    setLoading(true);
    api.getQuotes(status === "all" ? undefined : status)
      .then(setQuotes)
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  }

  useEffect(() => {
    loadQuotes();
    api.getSiteSettings().then(setSettings).catch(() => {});
  }, []);

  if (error) return <p className="text-red-600">Error: {error}</p>;

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-2xl font-bold text-gray-900">Quotes</h1>
        <Link href="/quotes/new" className="bg-blue-600 text-white px-4 py-2 rounded text-sm hover:bg-blue-700">
          New Quote
        </Link>
      </div>

      <div className="flex gap-2 mb-4 overflow-x-auto">
        {STATUSES.map((s) => (
          <button
            key={s}
            onClick={() => { setFilter(s); loadQuotes(s); }}
            className={`px-3 py-1.5 rounded text-sm capitalize whitespace-nowrap ${
              filter === s ? "bg-gray-900 text-white" : "bg-white border border-gray-300 text-gray-700 hover:bg-gray-50"
            }`}
          >
            {s}
          </button>
        ))}
      </div>

      {loading ? (
        <p className="text-gray-500">Loading quotes...</p>
      ) : quotes.length === 0 ? (
        <p className="text-gray-500">No quotes found.</p>
      ) : (
        <div className="space-y-3">
          {quotes.map((quote) => (
            <Link
              key={quote.id}
              href={`/quotes/${quote.id}`}
              className="block bg-white border border-gray-200 rounded-lg p-4 hover:border-blue-300 transition-colors"
            >
              <div className="flex items-start justify-between">
                <div>
                  <div className="flex items-center gap-2">
                    <h3 className="font-semibold text-gray-900">
                      Quote #{quote.id} v{quote.version}
                    </h3>
                    <span className={`text-xs px-2 py-0.5 rounded ${STATUS_COLORS[quote.status] || ""}`}>
                      {quote.status_display}
                    </span>
                  </div>
                  <p className="text-sm text-gray-500 mt-1">
                    {quote.account_name} &middot; {quote.event_date} &middot; {quote.guest_count} guests
                  </p>
                </div>
                <div className="text-right">
                  <p className="font-semibold text-gray-900">{settings.currency_symbol}{quote.total}</p>
                  <p className="text-xs text-gray-400">{new Date(quote.created_at).toLocaleDateString()}</p>
                </div>
              </div>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
