"use client";

import { useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import Link from "next/link";
import { api, Lead, Account, BudgetRangeOption, SiteSettingsData } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";


const STATUS_BADGE_VARIANT: Record<string, "info" | "warning" | "default" | "success" | "secondary"> = {
  new: "info",
  contacted: "warning",
  qualified: "default",
  converted: "success",
  lost: "secondary",
};

const TRANSITIONS: Record<string, string[]> = {
  new: ["contacted", "lost"],
  contacted: ["qualified", "lost"],
  qualified: ["converted", "lost"],
  lost: ["new"],
};

const TRANSITION_LABELS: Record<string, { label: string; variant: "default" | "success" | "warning" | "secondary" | "destructive" }> = {
  contacted: { label: "Mark Contacted", variant: "warning" },
  qualified: { label: "Mark Qualified", variant: "default" },
  converted: { label: "Convert to Quote", variant: "success" },
  lost: { label: "Mark Lost", variant: "secondary" },
  new: { label: "Reopen", variant: "default" },
};

const QUOTE_BADGE_VARIANT: Record<string, "success" | "info" | "secondary" | "destructive" | "warning"> = {
  accepted: "success",
  sent: "info",
  draft: "secondary",
  declined: "destructive",
};

export default function LeadDetailPage() {
  const { id } = useParams();
  const router = useRouter();
  const [lead, setLead] = useState<Lead | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [transitioning, setTransitioning] = useState(false);
  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [budgetRanges, setBudgetRanges] = useState<BudgetRangeOption[]>([]);
  const [settings, setSettings] = useState<SiteSettingsData>({ currency_symbol: "\u00a3", currency_code: "GBP", default_price_per_head: "0.00", target_food_cost_percentage: "30.00", price_rounding_step: "50" });
  const [editData, setEditData] = useState({
    contact_name: "",
    contact_email: "",
    contact_phone: "",
    account: "" as string | number,
    source: "",
    event_date: "",
    guest_estimate: "" as string | number,
    budget_range: "" as string | number,
    event_type: "",
    service_style: "",
    notes: "",
    lost_reason: "",
  });

  useEffect(() => {
    api.getLead(Number(id))
      .then(setLead)
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
    api.getSiteSettings().then(setSettings).catch(() => {});
    api.getBudgetRanges().then(setBudgetRanges).catch(() => {});
  }, [id]);

  function startEditing() {
    if (!lead) return;
    setEditData({
      contact_name: lead.contact_name,
      contact_email: lead.contact_email,
      contact_phone: lead.contact_phone,
      account: lead.account ?? "",
      source: lead.source,
      event_date: lead.event_date || "",
      guest_estimate: lead.guest_estimate ?? "",
      budget_range: lead.budget_range ?? "",
      event_type: lead.event_type,
      service_style: lead.service_style || "",
      notes: lead.notes,
      lost_reason: lead.lost_reason || "",
    });
    api.getAccounts().then(setAccounts).catch(() => {});
    setEditing(true);
  }

  async function handleSave(e: React.FormEvent) {
    e.preventDefault();
    if (!lead) return;
    setSaving(true);
    setError("");
    try {
      const updated = await api.updateLead(lead.id, {
        contact_name: editData.contact_name,
        contact_email: editData.contact_email,
        contact_phone: editData.contact_phone,
        account: editData.account ? Number(editData.account) : null,
        source: editData.source,
        event_date: editData.event_date || null,
        guest_estimate: editData.guest_estimate ? Number(editData.guest_estimate) : null,
        budget_range: editData.budget_range ? Number(editData.budget_range) : null,
        event_type: editData.event_type,
        service_style: editData.service_style || undefined,
        notes: editData.notes,
        lost_reason: editData.lost_reason,
      });
      setLead(updated);
      setEditing(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to save");
    } finally {
      setSaving(false);
    }
  }

  async function handleTransition(newStatus: string) {
    if (!lead) return;
    setTransitioning(true);
    setError("");
    try {
      if (newStatus === "converted") {
        const quote = await api.convertLead(lead.id);
        router.push(`/quotes/${quote.id}`);
        return;
      }
      const updated = await api.transitionLead(lead.id, newStatus);
      setLead(updated);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to transition");
    } finally {
      setTransitioning(false);
    }
  }

  if (loading) return <p className="text-muted-foreground">Loading...</p>;
  if (error && !lead) return <p className="text-destructive">Error: {error}</p>;
  if (!lead) return <p className="text-muted-foreground">Lead not found.</p>;

  const availableTransitions = TRANSITIONS[lead.status] || [];
  const cs = settings.currency_symbol;

  const setEdit = (field: string) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) =>
    setEditData({ ...editData, [field]: e.target.value });

  return (
    <div>
      <Link href="/leads" className="text-sm text-primary hover:underline mb-4 inline-block">&larr; Back to Leads</Link>

      {error && <p className="text-destructive mb-4">{error}</p>}

      <Card className="mb-6">
        <CardContent className="p-6">
          <div className="flex items-start justify-between mb-4">
            <div>
              <div className="flex items-center gap-3">
                <h1 className="text-2xl font-bold text-foreground">{lead.contact_name}</h1>
                <Badge variant={STATUS_BADGE_VARIANT[lead.status] || "secondary"}>
                  {lead.status_display}
                </Badge>
              </div>
              <p className="text-sm text-muted-foreground mt-1">
                {lead.event_type_display}
                {lead.event_date && ` \u00b7 ${lead.event_date}`}
                {lead.guest_estimate && ` \u00b7 ${lead.guest_estimate} guests`}
              </p>
            </div>
          </div>

          {editing ? (
            <form onSubmit={handleSave} className="border border-border bg-muted rounded p-4 mb-4">
              <h3 className="text-sm font-semibold text-foreground mb-3">Edit Lead</h3>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-foreground mb-1">Contact Name *</label>
                  <Input type="text" required value={editData.contact_name} onChange={setEdit("contact_name")} />
                </div>
                <div>
                  <label className="block text-sm font-medium text-foreground mb-1">Account</label>
                  <select value={editData.account} onChange={setEdit("account")} className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring">
                    <option value="">-- No account --</option>
                    {accounts.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
                  </select>
                </div>
                <div>
                  <label className="block text-sm font-medium text-foreground mb-1">Email</label>
                  <Input type="email" value={editData.contact_email} onChange={setEdit("contact_email")} />
                </div>
                <div>
                  <label className="block text-sm font-medium text-foreground mb-1">Phone</label>
                  <Input type="text" value={editData.contact_phone} onChange={setEdit("contact_phone")} />
                </div>
                <div>
                  <label className="block text-sm font-medium text-foreground mb-1">Source</label>
                  <select value={editData.source} onChange={setEdit("source")} className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring">
                    <option value="website">Website</option>
                    <option value="referral">Referral</option>
                    <option value="phone">Phone</option>
                    <option value="email">Email</option>
                    <option value="social">Social Media</option>
                    <option value="walk_in">Walk-in</option>
                    <option value="repeat">Repeat Customer</option>
                  </select>
                </div>
                <div>
                  <label className="block text-sm font-medium text-foreground mb-1">Event Type</label>
                  <select value={editData.event_type} onChange={setEdit("event_type")} className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring">
                    <option value="wedding">Wedding</option>
                    <option value="corporate">Corporate Event</option>
                    <option value="birthday">Birthday Party</option>
                    <option value="funeral">Funeral / Wake</option>
                    <option value="religious">Religious Event</option>
                    <option value="social">Social Gathering</option>
                    <option value="other">Other</option>
                  </select>
                </div>
                <div>
                  <label className="block text-sm font-medium text-foreground mb-1">Event Date</label>
                  <Input type="date" value={editData.event_date} onChange={setEdit("event_date")} />
                </div>
                <div>
                  <label className="block text-sm font-medium text-foreground mb-1">Guest Estimate</label>
                  <Input type="number" min="1" value={editData.guest_estimate} onChange={setEdit("guest_estimate")} />
                </div>
                <div>
                  <label className="block text-sm font-medium text-foreground mb-1">Budget Range</label>
                  <select value={editData.budget_range} onChange={setEdit("budget_range")} className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring">
                    <option value="">-- Select --</option>
                    {budgetRanges.map((b) => <option key={b.id} value={b.id}>{b.label}</option>)}
                  </select>
                </div>
                <div>
                  <label className="block text-sm font-medium text-foreground mb-1">Service Style</label>
                  <select value={editData.service_style} onChange={setEdit("service_style")} className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring">
                    <option value="">-- Select --</option>
                    <option value="buffet">Buffet</option>
                    <option value="plated">Plated / Sit-down</option>
                    <option value="stations">Food Stations</option>
                    <option value="family_style">Family Style</option>
                    <option value="boxed">Boxed / Individual</option>
                    <option value="canapes">Canapes</option>
                    <option value="mixed">Mixed Service</option>
                  </select>
                </div>
                <div className="md:col-span-2">
                  <label className="block text-sm font-medium text-foreground mb-1">Notes</label>
                  <Textarea value={editData.notes} onChange={setEdit("notes")} rows={3} />
                </div>
                {lead.status === "lost" && (
                  <div className="md:col-span-2">
                    <label className="block text-sm font-medium text-foreground mb-1">Lost Reason</label>
                    <Textarea value={editData.lost_reason} onChange={setEdit("lost_reason")} rows={2} />
                  </div>
                )}
              </div>
              <div className="flex gap-3 mt-4">
                <Button type="submit" disabled={saving}>
                  {saving ? "Saving..." : "Save Changes"}
                </Button>
                <Button type="button" variant="outline" onClick={() => setEditing(false)}>
                  Cancel
                </Button>
              </div>
            </form>
          ) : (
            <>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-sm">
                {lead.contact_email && <div><span className="text-muted-foreground">Email:</span> {lead.contact_email}</div>}
                {lead.contact_phone && <div><span className="text-muted-foreground">Phone:</span> {lead.contact_phone}</div>}
                {lead.account_name && <div><span className="text-muted-foreground">Account:</span> <Link href={`/accounts/${lead.account}`} className="text-primary hover:underline">{lead.account_name}</Link></div>}
                {lead.budget_range_label && <div><span className="text-muted-foreground">Budget:</span> {lead.budget_range_label}</div>}
                {lead.service_style && <div><span className="text-muted-foreground">Service:</span> {lead.service_style.replace(/_/g, " ")}</div>}
                <div><span className="text-muted-foreground">Source:</span> {lead.source.replace(/_/g, " ")}</div>
                {lead.notes && <div className="md:col-span-2"><span className="text-muted-foreground">Notes:</span> {lead.notes}</div>}
                {lead.lost_reason && <div className="md:col-span-2"><span className="text-muted-foreground">Lost reason:</span> {lead.lost_reason}</div>}
              </div>

              <div className="mt-4">
                <Button variant="outline" onClick={startEditing}>
                  Edit Details
                </Button>
              </div>
            </>
          )}

          {/* Timeline */}
          <div className="mt-6 border-t border-border pt-4">
            <h3 className="text-sm font-medium text-foreground mb-2">Timeline</h3>
            <div className="text-sm text-muted-foreground space-y-1">
              <div>Created: {new Date(lead.created_at).toLocaleString()}</div>
              {lead.contacted_at && <div>Contacted: {new Date(lead.contacted_at).toLocaleString()}</div>}
              {lead.qualified_at && <div>Qualified: {new Date(lead.qualified_at).toLocaleString()}</div>}
              {lead.converted_at && <div>Converted: {new Date(lead.converted_at).toLocaleString()}</div>}
              {lead.lost_at && <div>Lost: {new Date(lead.lost_at).toLocaleString()}</div>}
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Linked Quotes */}
      {lead.quotes && lead.quotes.length > 0 && (
        <Card className="mb-6">
          <CardContent className="p-6">
            <h2 className="text-lg font-semibold text-foreground mb-4">Quotes</h2>
            <div className="space-y-3">
              {lead.quotes.map((q) => (
                <Link
                  key={q.id}
                  href={`/quotes/${q.id}`}
                  className="flex items-center justify-between p-3 border border-border rounded hover:bg-muted transition-colors"
                >
                  <div className="flex items-center gap-3">
                    <span className="font-medium text-foreground">Quote #{q.id}</span>
                    <Badge variant={QUOTE_BADGE_VARIANT[q.status] || "warning"}>
                      {q.status_display}
                    </Badge>
                  </div>
                  <span className="font-semibold text-foreground">{cs}{q.total}</span>
                </Link>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Actions */}
      {availableTransitions.length > 0 && (
        <Card>
          <CardContent className="p-6">
            <h2 className="text-lg font-semibold text-foreground mb-4">Actions</h2>
            <div className="flex flex-wrap gap-3">
              {availableTransitions.map((status) => {
                const { label, variant } = TRANSITION_LABELS[status] || { label: status, variant: "default" as const };
                return (
                  <Button
                    key={status}
                    onClick={() => handleTransition(status)}
                    disabled={transitioning}
                    variant={variant}
                  >
                    {transitioning ? "..." : label}
                  </Button>
                );
              })}
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
