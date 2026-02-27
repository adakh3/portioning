"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { api, Invoice } from "@/lib/api";

const STATUS_TABS = [
  { value: "", label: "All" },
  { value: "draft", label: "Draft" },
  { value: "sent", label: "Sent" },
  { value: "partial", label: "Partial" },
  { value: "paid", label: "Paid" },
  { value: "overdue", label: "Overdue" },
  { value: "void", label: "Void" },
] as const;

const STATUS_COLORS: Record<string, string> = {
  draft: "bg-gray-100 text-gray-700",
  sent: "bg-blue-100 text-blue-700",
  partial: "bg-yellow-100 text-yellow-700",
  paid: "bg-green-100 text-green-700",
  overdue: "bg-red-100 text-red-700",
  void: "bg-gray-100 text-gray-400",
};

function formatDate(dateStr: string): string {
  if (!dateStr) return "-";
  const d = new Date(dateStr);
  return d.toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });
}

function invoiceTypeLabel(type: string): string {
  const labels: Record<string, string> = {
    deposit: "Deposit",
    interim: "Interim",
    final: "Final",
    credit: "Credit Note",
  };
  return labels[type] || type;
}

export default function InvoicesPage() {
  const [invoices, setInvoices] = useState<Invoice[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [statusFilter, setStatusFilter] = useState("");

  useEffect(() => {
    setLoading(true);
    api
      .getInvoices(statusFilter ? { status: statusFilter } : undefined)
      .then(setInvoices)
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  }, [statusFilter]);

  if (error) return <p className="text-red-600">Error: {error}</p>;

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-2xl font-bold text-gray-900">Invoices</h1>
      </div>

      <div className="flex gap-1 mb-6 border-b border-gray-200 overflow-x-auto">
        {STATUS_TABS.map((tab) => (
          <button
            key={tab.value}
            onClick={() => setStatusFilter(tab.value)}
            className={`px-4 py-2 text-sm font-medium border-b-2 -mb-px transition-colors whitespace-nowrap ${
              statusFilter === tab.value
                ? "border-blue-600 text-blue-600"
                : "border-transparent text-gray-500 hover:text-gray-700"
            }`}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {loading ? (
        <p className="text-gray-500">Loading invoices...</p>
      ) : invoices.length === 0 ? (
        <div className="bg-white border border-gray-200 rounded-lg p-8 text-center">
          <p className="text-gray-500">No invoices found.</p>
        </div>
      ) : (
        <div className="bg-white border border-gray-200 rounded-lg overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-gray-50 border-b border-gray-200">
                  <th className="text-left px-4 py-3 font-medium text-gray-700">Invoice #</th>
                  <th className="text-left px-4 py-3 font-medium text-gray-700">Event</th>
                  <th className="text-left px-4 py-3 font-medium text-gray-700">Type</th>
                  <th className="text-right px-4 py-3 font-medium text-gray-700">Total ({"\u00A3"})</th>
                  <th className="text-right px-4 py-3 font-medium text-gray-700">Balance ({"\u00A3"})</th>
                  <th className="text-left px-4 py-3 font-medium text-gray-700">Status</th>
                  <th className="text-left px-4 py-3 font-medium text-gray-700">Due Date</th>
                </tr>
              </thead>
              <tbody>
                {invoices.map((invoice) => (
                  <tr
                    key={invoice.id}
                    className="border-b border-gray-100 hover:bg-gray-50 transition-colors"
                  >
                    <td className="px-4 py-3">
                      <Link
                        href={`/invoices/${invoice.id}`}
                        className="text-blue-600 hover:underline font-medium"
                      >
                        {invoice.invoice_number}
                      </Link>
                    </td>
                    <td className="px-4 py-3">
                      <Link
                        href={`/events/${invoice.event}`}
                        className="text-blue-600 hover:underline"
                      >
                        Event #{invoice.event}
                      </Link>
                    </td>
                    <td className="px-4 py-3 text-gray-600">
                      {invoiceTypeLabel(invoice.invoice_type)}
                    </td>
                    <td className="px-4 py-3 text-right font-medium text-gray-900">
                      {"\u00A3"}{parseFloat(invoice.total).toFixed(2)}
                    </td>
                    <td className="px-4 py-3 text-right font-medium text-gray-900">
                      {"\u00A3"}{parseFloat(invoice.balance_due).toFixed(2)}
                    </td>
                    <td className="px-4 py-3">
                      <span
                        className={`inline-block text-xs px-2 py-0.5 rounded capitalize ${
                          STATUS_COLORS[invoice.status] || "bg-gray-100 text-gray-700"
                        }`}
                      >
                        {invoice.status}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-gray-600">{formatDate(invoice.due_date)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
