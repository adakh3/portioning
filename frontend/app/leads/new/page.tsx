"use client";

import { useState, useCallback } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { api } from "@/lib/api";
import { useAccounts, useProductLines, useUsers, useSources, useEventTypes, useServiceStyles, revalidate } from "@/lib/hooks";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardContent } from "@/components/ui/card";

export default function NewLeadPage() {
  const router = useRouter();
  const { data: accounts = [] } = useAccounts();
  const { data: productLines = [] } = useProductLines();
  const { data: users = [] } = useUsers();
  const { data: sources = [] } = useSources();
  const { data: eventTypes = [] } = useEventTypes();
  const { data: serviceStyles = [] } = useServiceStyles();
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [formData, setFormData] = useState({
    account: "" as string | number,
    contact_name: "",
    contact_email: "",
    contact_phone: "",
    source: "website",
    event_date: "",
    guest_estimate: "",
    budget: "",
    event_type: "other",
    service_style: "",
    product: "" as string | number,
    assigned_to: "" as string | number,
    notes: "",
  });

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    setError("");
    try {
      const data = {
        ...formData,
        account: formData.account ? Number(formData.account) : null,
        guest_estimate: formData.guest_estimate ? Number(formData.guest_estimate) : null,
        event_date: formData.event_date || null,
        budget: formData.budget || null,
        product: formData.product ? Number(formData.product) : null,
        assigned_to: formData.assigned_to ? Number(formData.assigned_to) : null,
      };
      const lead = await api.createLead(data);
      revalidate("leads");
      router.push(`/leads/${lead.id}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to create lead");
      setSaving(false);
    }
  }

  const set = (field: string) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) =>
    setFormData({ ...formData, [field]: e.target.value });

  return (
    <div>
      <Link href="/leads" className="text-sm text-primary hover:underline mb-4 inline-block">&larr; Back to Leads</Link>
      <h1 className="text-2xl font-bold text-foreground mb-6">New Lead</h1>

      {error && <p className="text-destructive mb-4">{error}</p>}

      <Card>
        <CardContent className="p-6">
          <form onSubmit={handleSubmit}>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium text-foreground mb-1">Contact Name *</label>
                <Input type="text" required value={formData.contact_name} onChange={set("contact_name")} />
              </div>
              <div>
                <label className="block text-sm font-medium text-foreground mb-1">Account (optional)</label>
                <select value={formData.account} onChange={set("account")} className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring">
                  <option value="">-- No account --</option>
                  {accounts.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
                </select>
              </div>
              <div>
                <label className="block text-sm font-medium text-foreground mb-1">Email</label>
                <Input type="email" value={formData.contact_email} onChange={set("contact_email")} />
              </div>
              <div>
                <label className="block text-sm font-medium text-foreground mb-1">Phone</label>
                <Input type="text" value={formData.contact_phone} onChange={set("contact_phone")} />
              </div>
              <div>
                <label className="block text-sm font-medium text-foreground mb-1">Source</label>
                <select value={formData.source} onChange={set("source")} className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring">
                  {sources.map((s) => <option key={s.id} value={s.value}>{s.label}</option>)}
                </select>
              </div>
              <div>
                <label className="block text-sm font-medium text-foreground mb-1">Event Type</label>
                <select value={formData.event_type} onChange={set("event_type")} className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring">
                  {eventTypes.map((et) => <option key={et.id} value={et.value}>{et.label}</option>)}
                </select>
              </div>
              <div>
                <label className="block text-sm font-medium text-foreground mb-1">Event Date</label>
                <Input type="date" value={formData.event_date} onChange={set("event_date")} />
              </div>
              <div>
                <label className="block text-sm font-medium text-foreground mb-1">Guest Estimate</label>
                <Input type="number" min="1" value={formData.guest_estimate} onChange={set("guest_estimate")} />
              </div>
              <div>
                <label className="block text-sm font-medium text-foreground mb-1">Budget</label>
                <Input
                  type="text"
                  inputMode="numeric"
                  value={formData.budget ? parseInt(formData.budget, 10).toLocaleString() : ""}
                  onChange={(e) => {
                    const raw = e.target.value.replace(/[^0-9]/g, "");
                    setFormData({ ...formData, budget: raw });
                  }}
                  placeholder="e.g. 5,000"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-foreground mb-1">Service Style</label>
                <select value={formData.service_style} onChange={set("service_style")} className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring">
                  <option value="">-- Select --</option>
                  {serviceStyles.map((ss) => <option key={ss.id} value={ss.value}>{ss.label}</option>)}
                </select>
              </div>
              <div>
                <label className="block text-sm font-medium text-foreground mb-1">Product / Service</label>
                <select value={formData.product} onChange={set("product")} className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring">
                  <option value="">-- Select --</option>
                  {productLines.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
                </select>
              </div>
              <div>
                <label className="block text-sm font-medium text-foreground mb-1">Assigned To</label>
                <select value={formData.assigned_to} onChange={set("assigned_to")} className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring">
                  <option value="">-- Unassigned --</option>
                  {users.map((u) => <option key={u.id} value={u.id}>{u.first_name} {u.last_name}</option>)}
                </select>
              </div>
              <div className="md:col-span-2">
                <label className="block text-sm font-medium text-foreground mb-1">Notes</label>
                <Textarea value={formData.notes} onChange={set("notes")} rows={3} />
              </div>
            </div>
            <Button type="submit" disabled={saving} variant="success" className="mt-6">
              {saving ? "Creating..." : "Create Lead"}
            </Button>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
