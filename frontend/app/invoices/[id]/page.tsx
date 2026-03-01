"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useEffect, useState, useCallback } from "react";
import { api, Invoice } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";

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

  if (loading) return <p className="text-muted-foreground">Loading invoice...</p>;
  if (error && !invoice) return <p className="text-destructive">Error: {error}</p>;
  if (!invoice) return <p className="text-muted-foreground">Invoice not found.</p>;

  return (
    <div>
      <div className="mb-6">
        <Button variant="link" asChild className="px-0">
          <Link href="/invoices">&larr; Back to Invoices</Link>
        </Button>
      </div>

      {error && <p className="text-destructive mb-4">{error}</p>}

      {/* Header */}
      <Card className="mb-6">
        <CardContent className="pt-6">
          <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-4">
            <div>
              <h1 className="text-2xl font-bold text-foreground">{invoice.invoice_number}</h1>
              <Badge variant={STATUS_BADGE_VARIANT[invoice.status] || "secondary"} className="mt-2 capitalize">
                {invoice.status}
              </Badge>
            </div>
            <div className="text-right">
              <p className="text-sm text-muted-foreground">Total</p>
              <p className="text-2xl font-bold text-foreground">
                {"\u00A3"}{parseFloat(invoice.total).toFixed(2)}
              </p>
              <p className="text-sm text-muted-foreground mt-1">
                Balance Due:{" "}
                <span className="font-semibold text-foreground">
                  {"\u00A3"}{parseFloat(invoice.balance_due).toFixed(2)}
                </span>
              </p>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Details */}
      <Card className="mb-6">
        <CardHeader>
          <CardTitle>Details</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
            <div>
              <p className="text-sm text-muted-foreground">Event</p>
              <Link href={`/events/${invoice.event}`} className="text-primary hover:underline text-sm font-medium">
                Event #{invoice.event}
              </Link>
            </div>
            <div>
              <p className="text-sm text-muted-foreground">Type</p>
              <p className="text-sm font-medium text-foreground">{invoiceTypeLabel(invoice.invoice_type)}</p>
            </div>
            <div>
              <p className="text-sm text-muted-foreground">Issue Date</p>
              <p className="text-sm font-medium text-foreground">{formatDate(invoice.issue_date)}</p>
            </div>
            <div>
              <p className="text-sm text-muted-foreground">Due Date</p>
              <p className="text-sm font-medium text-foreground">{formatDate(invoice.due_date)}</p>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Financial Breakdown */}
      <Card className="mb-6">
        <CardHeader>
          <CardTitle>Financial Breakdown</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="space-y-2">
            <div className="flex justify-between text-sm">
              <span className="text-muted-foreground">Subtotal</span>
              <span className="font-medium text-foreground">
                {"\u00A3"}{parseFloat(invoice.subtotal).toFixed(2)}
              </span>
            </div>
            <div className="flex justify-between text-sm">
              <span className="text-muted-foreground">Tax Rate</span>
              <span className="font-medium text-foreground">{parseFloat(invoice.tax_rate).toFixed(1)}%</span>
            </div>
            <div className="flex justify-between text-sm">
              <span className="text-muted-foreground">Tax Amount</span>
              <span className="font-medium text-foreground">
                {"\u00A3"}{parseFloat(invoice.tax_amount).toFixed(2)}
              </span>
            </div>
            <div className="flex justify-between text-sm pt-2 border-t border-border">
              <span className="font-semibold text-foreground">Total</span>
              <span className="font-bold text-foreground">
                {"\u00A3"}{parseFloat(invoice.total).toFixed(2)}
              </span>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Payments */}
      <Card className="mb-6">
        <CardHeader>
          <div className="flex items-center justify-between">
            <CardTitle>Payments</CardTitle>
            {invoice.status !== "void" && invoice.status !== "paid" && (
              <Button
                size="sm"
                onClick={() => setShowPaymentForm(!showPaymentForm)}
              >
                {showPaymentForm ? "Cancel" : "Record Payment"}
              </Button>
            )}
          </div>
        </CardHeader>
        <CardContent>
          {showPaymentForm && (
            <form onSubmit={handleRecordPayment} className="bg-muted border border-border rounded-lg p-4 mb-4">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-foreground mb-1">Amount *</label>
                  <Input
                    type="number"
                    step="0.01"
                    required
                    value={paymentData.amount}
                    onChange={(e) => setPaymentData({ ...paymentData, amount: e.target.value })}
                    placeholder="0.00"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-foreground mb-1">Payment Date</label>
                  <Input
                    type="date"
                    value={paymentData.payment_date}
                    onChange={(e) => setPaymentData({ ...paymentData, payment_date: e.target.value })}
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-foreground mb-1">Method</label>
                  <select
                    value={paymentData.method}
                    onChange={(e) => setPaymentData({ ...paymentData, method: e.target.value })}
                    className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                  >
                    <option value="card">Card</option>
                    <option value="bank_transfer">Bank Transfer</option>
                    <option value="cash">Cash</option>
                    <option value="check">Check</option>
                    <option value="other">Other</option>
                  </select>
                </div>
                <div>
                  <label className="block text-sm font-medium text-foreground mb-1">Reference</label>
                  <Input
                    type="text"
                    value={paymentData.reference}
                    onChange={(e) => setPaymentData({ ...paymentData, reference: e.target.value })}
                    placeholder="Transaction ref, check #, etc."
                  />
                </div>
              </div>
              <div className="flex gap-2 mt-4">
                <Button
                  type="submit"
                  disabled={paymentSaving}
                  variant="success"
                >
                  {paymentSaving ? "Saving..." : "Save Payment"}
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => setShowPaymentForm(false)}
                >
                  Cancel
                </Button>
              </div>
            </form>
          )}

          {invoice.payments.length === 0 ? (
            <p className="text-muted-foreground text-sm">No payments recorded.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="bg-muted border-b border-border">
                    <th className="text-right px-4 py-2 font-medium text-muted-foreground">Amount</th>
                    <th className="text-left px-4 py-2 font-medium text-muted-foreground">Date</th>
                    <th className="text-left px-4 py-2 font-medium text-muted-foreground">Method</th>
                    <th className="text-left px-4 py-2 font-medium text-muted-foreground">Reference</th>
                  </tr>
                </thead>
                <tbody>
                  {invoice.payments.map((payment) => (
                    <tr key={payment.id} className="border-b border-border">
                      <td className="px-4 py-2 text-right font-medium text-foreground">
                        {"\u00A3"}{parseFloat(payment.amount).toFixed(2)}
                      </td>
                      <td className="px-4 py-2 text-muted-foreground">{formatDate(payment.payment_date)}</td>
                      <td className="px-4 py-2 text-muted-foreground capitalize">
                        {payment.method.replace("_", " ")}
                      </td>
                      <td className="px-4 py-2 text-muted-foreground">{payment.reference || "-"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Action Buttons */}
      <div className="flex flex-wrap gap-3">
        {invoice.status === "draft" && (
          <Button
            onClick={() => handleStatusChange("sent")}
            disabled={actionLoading}
          >
            {actionLoading ? "Sending..." : "Send"}
          </Button>
        )}
        {(invoice.status === "sent" || invoice.status === "partial") && (
          <Button
            variant="destructive"
            onClick={() => handleStatusChange("void")}
            disabled={actionLoading}
          >
            {actionLoading ? "Voiding..." : "Mark Void"}
          </Button>
        )}
        <Button variant="outline" asChild>
          <Link href="/invoices">Back to Invoices</Link>
        </Button>
      </div>
    </div>
  );
}
