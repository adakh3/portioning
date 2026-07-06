"use client";

import { useState } from "react";
import { api, EventData, AuthUser } from "@/lib/api";
import { formatCurrency } from "@/lib/utils";
import { formatDate } from "@/lib/dateFormat";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { ValidatedInput } from "@/components/ui/validated-input";

const METHODS = [
  { value: "cash", label: "Cash" },
  { value: "bank_transfer", label: "Bank Transfer" },
  { value: "card", label: "Card" },
  { value: "check", label: "Cheque" },
  { value: "other", label: "Other" },
];

const STATUS_META: Record<string, { label: string; variant: "secondary" | "warning" | "success" }> = {
  unpaid: { label: "Unpaid", variant: "secondary" },
  partial: { label: "Part paid", variant: "warning" },
  paid: { label: "Paid", variant: "success" },
};

function userLabel(u: AuthUser): string {
  return `${u.first_name} ${u.last_name}`.trim() || u.email;
}

function todayISO(): string {
  return new Date().toISOString().slice(0, 10);
}

interface Props {
  event: EventData;
  users: AuthUser[];
  currencySymbol: string;
  dateFormat: string;
  currentUserId?: number | null;
  /** Refetch the event after a change so totals/balance update. */
  onChange: () => void;
}

/** Records client payments (advance / part / full) against a booking and shows
 *  paid-vs-owed. Read-model over the event's payments; recording/deleting calls
 *  the event-payment API and refreshes the parent event. */
export default function EventPaymentsCard({
  event, users, currencySymbol, dateFormat, currentUserId, onChange,
}: Props) {
  const [showForm, setShowForm] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [form, setForm] = useState({
    amount: "",
    payment_date: todayISO(),
    method: "cash",
    received_by: currentUserId ? String(currentUserId) : "",
    reference: "",
  });

  const cs = currencySymbol;
  const total = parseFloat(event.total || "0");
  const paid = parseFloat(event.amount_paid || "0");
  const balance = parseFloat(event.balance_due || "0");
  const meta = STATUS_META[event.payment_status] ?? STATUS_META.unpaid;

  function reset() {
    setForm({
      amount: "", payment_date: todayISO(), method: "cash",
      received_by: currentUserId ? String(currentUserId) : "", reference: "",
    });
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    setError("");
    try {
      await api.createEventPayment(event.id, {
        amount: form.amount,
        payment_date: form.payment_date,
        method: form.method,
        received_by: form.received_by ? Number(form.received_by) : null,
        reference: form.reference,
      });
      setShowForm(false);
      reset();
      onChange();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to record payment.");
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete(paymentId: number) {
    setError("");
    try {
      await api.deleteEventPayment(event.id, paymentId);
      onChange();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to delete payment.");
    }
  }

  return (
    <Card>
      <CardContent className="p-6">
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide">
            Payments
          </h2>
          <Button size="sm" onClick={() => setShowForm((s) => !s)}>
            {showForm ? "Cancel" : "Record Payment"}
          </Button>
        </div>

        {/* Balance summary */}
        <div className="flex flex-wrap gap-x-8 gap-y-2 mb-4 text-sm">
          <div>
            <div className="text-muted-foreground">Total</div>
            <div className="font-medium text-foreground">{formatCurrency(total, cs)}</div>
          </div>
          <div>
            <div className="text-muted-foreground">Paid</div>
            <div className="font-medium text-foreground">{formatCurrency(paid, cs)}</div>
          </div>
          <div>
            <div className="text-muted-foreground">Balance due</div>
            <div className="font-medium text-foreground">{formatCurrency(balance, cs)}</div>
          </div>
          <div className="flex items-center">
            <Badge variant={meta.variant}>{meta.label}</Badge>
          </div>
        </div>

        {error && (
          <div className="rounded-md border border-destructive/30 bg-destructive/10 px-4 py-2 text-sm text-destructive mb-4">
            {error}
          </div>
        )}

        {showForm && (
          <form onSubmit={handleSubmit} className="bg-muted border border-border rounded-lg p-4 mb-4">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium text-foreground mb-1">Amount *</label>
                <ValidatedInput
                  type="number" step="0.01" min="0.01" required
                  value={form.amount}
                  onChange={(e) => setForm({ ...form, amount: e.target.value })}
                  placeholder="0.00"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-foreground mb-1">Payment Date *</label>
                <Input
                  type="date" required
                  value={form.payment_date}
                  onChange={(e) => setForm({ ...form, payment_date: e.target.value })}
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-foreground mb-1">Method *</label>
                <select
                  required
                  value={form.method}
                  onChange={(e) => setForm({ ...form, method: e.target.value })}
                  className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                >
                  {METHODS.map((m) => (
                    <option key={m.value} value={m.value}>{m.label}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-sm font-medium text-foreground mb-1">Received By</label>
                <select
                  value={form.received_by}
                  onChange={(e) => setForm({ ...form, received_by: e.target.value })}
                  className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                >
                  <option value="">—</option>
                  {users.map((u) => (
                    <option key={u.id} value={u.id}>{userLabel(u)}</option>
                  ))}
                </select>
              </div>
              <div className="sm:col-span-2">
                <label className="block text-sm font-medium text-foreground mb-1">Reference</label>
                <Input
                  type="text" maxLength={200}
                  value={form.reference}
                  onChange={(e) => setForm({ ...form, reference: e.target.value })}
                  placeholder="Transaction ref, cheque #, etc."
                />
              </div>
            </div>
            <div className="flex gap-2 mt-4">
              <Button type="submit" variant="success" disabled={saving}>
                {saving ? "Saving…" : "Save Payment"}
              </Button>
              <Button type="button" variant="outline" onClick={() => { setShowForm(false); reset(); }}>
                Cancel
              </Button>
            </div>
          </form>
        )}

        {event.payments.length === 0 ? (
          <p className="text-muted-foreground text-sm">No payments recorded.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-muted border-b border-border">
                  <th className="text-left px-4 py-2 font-medium text-muted-foreground">Date</th>
                  <th className="text-right px-4 py-2 font-medium text-muted-foreground">Amount</th>
                  <th className="text-left px-4 py-2 font-medium text-muted-foreground">Method</th>
                  <th className="text-left px-4 py-2 font-medium text-muted-foreground">Received By</th>
                  <th className="text-left px-4 py-2 font-medium text-muted-foreground">Reference</th>
                  <th className="px-4 py-2"></th>
                </tr>
              </thead>
              <tbody>
                {event.payments.map((p) => (
                  <tr key={p.id} className="border-b border-border">
                    <td className="px-4 py-2 text-muted-foreground">{formatDate(p.payment_date, dateFormat)}</td>
                    <td className="px-4 py-2 text-right font-medium text-foreground">{formatCurrency(p.amount, cs)}</td>
                    <td className="px-4 py-2 text-muted-foreground">{p.method_display || p.method.replace("_", " ")}</td>
                    <td className="px-4 py-2 text-muted-foreground">{p.received_by_name || "—"}</td>
                    <td className="px-4 py-2 text-muted-foreground">{p.reference || "—"}</td>
                    <td className="px-4 py-2 text-right">
                      <Button
                        size="sm" variant="ghost"
                        onClick={() => handleDelete(p.id)}
                        aria-label="Delete payment"
                      >
                        Delete
                      </Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
