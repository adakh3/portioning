"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useEffect, useState, useCallback } from "react";
import { api, Invoice } from "@/lib/api";

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

function todayISO(): string {
  return new Date().toISOString().split("T")[0];
}

export default function InvoiceDetailPage() {
  const params = useParams();
  const invoiceId = Number(params.id);

  const [invoice, setInvoice] = useState<Invoice | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [actionLoading, setActionLoading] = useState(false);

  const [showPaymentForm, setShowPaymentForm] = useState(false);
  const [paymentSaving, setPaymentSaving] = useState(false);
  const [paymentData, setPaymentData] = useState({
    amount: "",
    payment_date: todayISO(),
    method: "card",
    reference: "",
  });

  const fetchInvoice = useCallback(() => {
    setLoading(true);
    api
      .getInvoice(invoiceId)
      .then(setInvoice)
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  }, [invoiceId]);

  useEffect(() => {
    fetchInvoice();
  }, [fetchInvoice]);

  async function handleRecordPayment(e: React.FormEvent) {
    e.preventDefault();
    setPaymentSaving(true);
    try {
      await api.createPayment(invoiceId, {
        amount: paymentData.amount,
        payment_date: paymentData.payment_date,
        method: paymentData.method,
        reference: paymentData.reference,
      });
      setShowPaymentForm(false);
      setPaymentData({ amount: "", payment_date: todayISO(), method: "card", reference: "" });
      fetchInvoice();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to record payment");
    } finally {
      setPaymentSaving(false);
    }
  }

  async function handleStatusChange(newStatus: string) {
    setActionLoading(true);
    try {
      await api.updateInvoice(invoiceId, { status: newStatus } as Partial<Invoice>);
      fetchInvoice();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to update invoice status");
    } finally {
      setActionLoading(false);
    }
  }

  if (loading) return <p className="text-gray-500">Loading invoice...</p>;
  if (error && !invoice) return <p className="text-red-600">Error: {error}</p>;
  if (!invoice) return <p className="text-gray-500">Invoice not found.</p>;

  return (
    <div>
      <div className="mb-6">
        <Link href="/invoices" className="text-blue-600 hover:underline text-sm">
          &larr; Back to Invoices
        </Link>
      </div>

      {error && <p className="text-red-600 mb-4">{error}</p>}

      {/* Header */}
      <div className="bg-white border border-gray-200 rounded-lg p-6 mb-6">
        <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-4">
          <div>
            <h1 className="text-2xl font-bold text-gray-900">{invoice.invoice_number}</h1>
            <span
              className={`inline-block mt-2 text-xs px-2.5 py-1 rounded capitalize ${
                STATUS_COLORS[invoice.status] || "bg-gray-100 text-gray-700"
              }`}
            >
              {invoice.status}
            </span>
          </div>
          <div className="text-right">
            <p className="text-sm text-gray-500">Total</p>
            <p className="text-2xl font-bold text-gray-900">
              {"\u00A3"}{parseFloat(invoice.total).toFixed(2)}
            </p>
            <p className="text-sm text-gray-500 mt-1">
              Balance Due:{" "}
              <span className="font-semibold text-gray-900">
                {"\u00A3"}{parseFloat(invoice.balance_due).toFixed(2)}
              </span>
            </p>
          </div>
        </div>
      </div>

      {/* Details */}
      <div className="bg-white border border-gray-200 rounded-lg p-6 mb-6">
        <h2 className="text-lg font-semibold text-gray-900 mb-4">Details</h2>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          <div>
            <p className="text-sm text-gray-500">Event</p>
            <Link href={`/events/${invoice.event}`} className="text-blue-600 hover:underline text-sm font-medium">
              Event #{invoice.event}
            </Link>
          </div>
          <div>
            <p className="text-sm text-gray-500">Type</p>
            <p className="text-sm font-medium text-gray-900">{invoiceTypeLabel(invoice.invoice_type)}</p>
          </div>
          <div>
            <p className="text-sm text-gray-500">Issue Date</p>
            <p className="text-sm font-medium text-gray-900">{formatDate(invoice.issue_date)}</p>
          </div>
          <div>
            <p className="text-sm text-gray-500">Due Date</p>
            <p className="text-sm font-medium text-gray-900">{formatDate(invoice.due_date)}</p>
          </div>
        </div>
      </div>

      {/* Financial Breakdown */}
      <div className="bg-white border border-gray-200 rounded-lg p-6 mb-6">
        <h2 className="text-lg font-semibold text-gray-900 mb-4">Financial Breakdown</h2>
        <div className="space-y-2">
          <div className="flex justify-between text-sm">
            <span className="text-gray-600">Subtotal</span>
            <span className="font-medium text-gray-900">
              {"\u00A3"}{parseFloat(invoice.subtotal).toFixed(2)}
            </span>
          </div>
          <div className="flex justify-between text-sm">
            <span className="text-gray-600">Tax Rate</span>
            <span className="font-medium text-gray-900">{parseFloat(invoice.tax_rate).toFixed(1)}%</span>
          </div>
          <div className="flex justify-between text-sm">
            <span className="text-gray-600">Tax Amount</span>
            <span className="font-medium text-gray-900">
              {"\u00A3"}{parseFloat(invoice.tax_amount).toFixed(2)}
            </span>
          </div>
          <div className="flex justify-between text-sm pt-2 border-t border-gray-200">
            <span className="font-semibold text-gray-900">Total</span>
            <span className="font-bold text-gray-900">
              {"\u00A3"}{parseFloat(invoice.total).toFixed(2)}
            </span>
          </div>
        </div>
      </div>

      {/* Payments */}
      <div className="bg-white border border-gray-200 rounded-lg p-6 mb-6">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-lg font-semibold text-gray-900">Payments</h2>
          {invoice.status !== "void" && invoice.status !== "paid" && (
            <button
              onClick={() => setShowPaymentForm(!showPaymentForm)}
              className="bg-blue-600 text-white px-4 py-2 rounded text-sm hover:bg-blue-700"
            >
              {showPaymentForm ? "Cancel" : "Record Payment"}
            </button>
          )}
        </div>

        {showPaymentForm && (
          <form onSubmit={handleRecordPayment} className="bg-gray-50 border border-gray-200 rounded-lg p-4 mb-4">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Amount *</label>
                <input
                  type="number"
                  step="0.01"
                  required
                  value={paymentData.amount}
                  onChange={(e) => setPaymentData({ ...paymentData, amount: e.target.value })}
                  className="w-full border border-gray-300 rounded px-3 py-2 text-sm focus:ring-1 focus:ring-blue-500"
                  placeholder="0.00"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Payment Date</label>
                <input
                  type="date"
                  value={paymentData.payment_date}
                  onChange={(e) => setPaymentData({ ...paymentData, payment_date: e.target.value })}
                  className="w-full border border-gray-300 rounded px-3 py-2 text-sm focus:ring-1 focus:ring-blue-500"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Method</label>
                <select
                  value={paymentData.method}
                  onChange={(e) => setPaymentData({ ...paymentData, method: e.target.value })}
                  className="w-full border border-gray-300 rounded px-3 py-2 text-sm focus:ring-1 focus:ring-blue-500"
                >
                  <option value="card">Card</option>
                  <option value="bank_transfer">Bank Transfer</option>
                  <option value="cash">Cash</option>
                  <option value="check">Check</option>
                  <option value="other">Other</option>
                </select>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Reference</label>
                <input
                  type="text"
                  value={paymentData.reference}
                  onChange={(e) => setPaymentData({ ...paymentData, reference: e.target.value })}
                  className="w-full border border-gray-300 rounded px-3 py-2 text-sm focus:ring-1 focus:ring-blue-500"
                  placeholder="Transaction ref, check #, etc."
                />
              </div>
            </div>
            <div className="flex gap-2 mt-4">
              <button
                type="submit"
                disabled={paymentSaving}
                className="bg-green-600 text-white px-4 py-2 rounded text-sm hover:bg-green-700 disabled:opacity-50"
              >
                {paymentSaving ? "Saving..." : "Save Payment"}
              </button>
              <button
                type="button"
                onClick={() => setShowPaymentForm(false)}
                className="border border-gray-300 text-gray-700 px-4 py-2 rounded text-sm hover:bg-gray-50"
              >
                Cancel
              </button>
            </div>
          </form>
        )}

        {invoice.payments.length === 0 ? (
          <p className="text-gray-500 text-sm">No payments recorded.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-gray-50 border-b border-gray-200">
                  <th className="text-right px-4 py-2 font-medium text-gray-700">Amount</th>
                  <th className="text-left px-4 py-2 font-medium text-gray-700">Date</th>
                  <th className="text-left px-4 py-2 font-medium text-gray-700">Method</th>
                  <th className="text-left px-4 py-2 font-medium text-gray-700">Reference</th>
                </tr>
              </thead>
              <tbody>
                {invoice.payments.map((payment) => (
                  <tr key={payment.id} className="border-b border-gray-100">
                    <td className="px-4 py-2 text-right font-medium text-gray-900">
                      {"\u00A3"}{parseFloat(payment.amount).toFixed(2)}
                    </td>
                    <td className="px-4 py-2 text-gray-600">{formatDate(payment.payment_date)}</td>
                    <td className="px-4 py-2 text-gray-600 capitalize">
                      {payment.method.replace("_", " ")}
                    </td>
                    <td className="px-4 py-2 text-gray-600">{payment.reference || "-"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Action Buttons */}
      <div className="flex flex-wrap gap-3">
        {invoice.status === "draft" && (
          <button
            onClick={() => handleStatusChange("sent")}
            disabled={actionLoading}
            className="bg-blue-600 text-white px-5 py-2 rounded text-sm hover:bg-blue-700 disabled:opacity-50"
          >
            {actionLoading ? "Sending..." : "Send"}
          </button>
        )}
        {(invoice.status === "sent" || invoice.status === "partial") && (
          <button
            onClick={() => handleStatusChange("void")}
            disabled={actionLoading}
            className="bg-red-600 text-white px-5 py-2 rounded text-sm hover:bg-red-700 disabled:opacity-50"
          >
            {actionLoading ? "Voiding..." : "Mark Void"}
          </button>
        )}
        <Link
          href="/invoices"
          className="border border-gray-300 text-gray-700 px-5 py-2 rounded text-sm hover:bg-gray-50 inline-block"
        >
          Back to Invoices
        </Link>
      </div>
    </div>
  );
}
