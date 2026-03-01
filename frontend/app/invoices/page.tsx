"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { api, Invoice } from "@/lib/api";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";

const STATUS_TABS = [
  { value: "", label: "All" },
  { value: "draft", label: "Draft" },
  { value: "sent", label: "Sent" },
  { value: "partial", label: "Partial" },
  { value: "paid", label: "Paid" },
  { value: "overdue", label: "Overdue" },
  { value: "void", label: "Void" },
] as const;

const STATUS_BADGE_VARIANT: Record<string, "secondary" | "info" | "warning" | "success" | "destructive" | "outline"> = {
  draft: "secondary",
  sent: "info",
  partial: "warning",
  paid: "success",
  overdue: "destructive",
  void: "outline",
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

  if (error) return <p className="text-destructive">Error: {error}</p>;

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-2xl font-bold text-foreground">Invoices</h1>
      </div>

      <div className="flex gap-1 mb-6 border-b border-border overflow-x-auto">
        {STATUS_TABS.map((tab) => (
          <button
            key={tab.value}
            onClick={() => setStatusFilter(tab.value)}
            className={`px-4 py-2 text-sm font-medium border-b-2 -mb-px transition-colors whitespace-nowrap ${
              statusFilter === tab.value
                ? "border-primary text-primary"
                : "border-transparent text-muted-foreground hover:text-foreground"
            }`}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {loading ? (
        <p className="text-muted-foreground">Loading invoices...</p>
      ) : invoices.length === 0 ? (
        <Card className="p-8 text-center">
          <p className="text-muted-foreground">No invoices found.</p>
        </Card>
      ) : (
        <Card className="overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-muted border-b border-border">
                  <th className="text-left px-4 py-3 font-medium text-muted-foreground">Invoice #</th>
                  <th className="text-left px-4 py-3 font-medium text-muted-foreground">Event</th>
                  <th className="text-left px-4 py-3 font-medium text-muted-foreground">Type</th>
                  <th className="text-right px-4 py-3 font-medium text-muted-foreground">Total ({"\u00A3"})</th>
                  <th className="text-right px-4 py-3 font-medium text-muted-foreground">Balance ({"\u00A3"})</th>
                  <th className="text-left px-4 py-3 font-medium text-muted-foreground">Status</th>
                  <th className="text-left px-4 py-3 font-medium text-muted-foreground">Due Date</th>
                </tr>
              </thead>
              <tbody>
                {invoices.map((invoice) => (
                  <tr
                    key={invoice.id}
                    className="border-b border-border hover:bg-muted transition-colors"
                  >
                    <td className="px-4 py-3">
                      <Link
                        href={`/invoices/${invoice.id}`}
                        className="text-primary hover:underline font-medium"
                      >
                        {invoice.invoice_number}
                      </Link>
                    </td>
                    <td className="px-4 py-3">
                      <Link
                        href={`/events/${invoice.event}`}
                        className="text-primary hover:underline"
                      >
                        Event #{invoice.event}
                      </Link>
                    </td>
                    <td className="px-4 py-3 text-muted-foreground">
                      {invoiceTypeLabel(invoice.invoice_type)}
                    </td>
                    <td className="px-4 py-3 text-right font-medium text-foreground">
                      {"\u00A3"}{parseFloat(invoice.total).toFixed(2)}
                    </td>
                    <td className="px-4 py-3 text-right font-medium text-foreground">
                      {"\u00A3"}{parseFloat(invoice.balance_due).toFixed(2)}
                    </td>
                    <td className="px-4 py-3">
                      <Badge variant={STATUS_BADGE_VARIANT[invoice.status] || "secondary"} className="capitalize">
                        {invoice.status}
                      </Badge>
                    </td>
                    <td className="px-4 py-3 text-muted-foreground">{formatDate(invoice.due_date)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      )}
    </div>
  );
}
