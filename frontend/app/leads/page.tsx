"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { api, Lead } from "@/lib/api";

const STATUS_COLORS: Record<string, string> = {
  new: "bg-blue-100 text-blue-700",
  contacted: "bg-yellow-100 text-yellow-700",
  qualified: "bg-purple-100 text-purple-700",
  converted: "bg-green-100 text-green-700",
  lost: "bg-gray-100 text-gray-500",
};

const STATUSES = ["all", "new", "contacted", "qualified", "converted", "lost"];

export default function LeadsPage() {
  const [leads, setLeads] = useState<Lead[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [filter, setFilter] = useState("all");

  function loadLeads(status?: string) {
    setLoading(true);
    api.getLeads(status === "all" ? undefined : status)
      .then(setLeads)
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  }

  useEffect(() => {
    loadLeads();
  }, []);

  function handleFilterChange(status: string) {
    setFilter(status);
    loadLeads(status);
  }

  if (error) return <p className="text-red-600">Error: {error}</p>;

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-2xl font-bold text-gray-900">Leads</h1>
        <Link href="/leads/new" className="bg-blue-600 text-white px-4 py-2 rounded text-sm hover:bg-blue-700">
          New Lead
        </Link>
      </div>

      <div className="flex gap-2 mb-4 overflow-x-auto">
        {STATUSES.map((s) => (
          <button
            key={s}
            onClick={() => handleFilterChange(s)}
            className={`px-3 py-1.5 rounded text-sm capitalize whitespace-nowrap ${
              filter === s ? "bg-gray-900 text-white" : "bg-white border border-gray-300 text-gray-700 hover:bg-gray-50"
            }`}
          >
            {s}
          </button>
        ))}
      </div>

      {loading ? (
        <p className="text-gray-500">Loading leads...</p>
      ) : leads.length === 0 ? (
        <p className="text-gray-500">No leads found.</p>
      ) : (
        <div className="space-y-3">
          {leads.map((lead) => (
            <Link
              key={lead.id}
              href={`/leads/${lead.id}`}
              className="block bg-white border border-gray-200 rounded-lg p-4 hover:border-blue-300 transition-colors"
            >
              <div className="flex items-start justify-between">
                <div>
                  <div className="flex items-center gap-2">
                    <h3 className="font-semibold text-gray-900">{lead.contact_name}</h3>
                    <span className={`text-xs px-2 py-0.5 rounded ${STATUS_COLORS[lead.status] || ""}`}>
                      {lead.status_display}
                    </span>
                  </div>
                  <p className="text-sm text-gray-500 mt-1">
                    {lead.event_type_display}
                    {lead.event_date && ` \u00b7 ${lead.event_date}`}
                    {lead.guest_estimate && ` \u00b7 ${lead.guest_estimate} guests`}
                  </p>
                  {lead.account_name && (
                    <p className="text-sm text-gray-400 mt-1">{lead.account_name}</p>
                  )}
                </div>
                <span className="text-xs text-gray-400">{new Date(lead.created_at).toLocaleDateString()}</span>
              </div>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
