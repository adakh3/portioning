"use client";

import { useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import Link from "next/link";
import { api, Lead, Account, BudgetRangeOption, SiteSettingsData } from "@/lib/api";

const STATUS_COLORS: Record<string, string> = {
  new: "bg-blue-100 text-blue-700",
  contacted: "bg-yellow-100 text-yellow-700",
  qualified: "bg-purple-100 text-purple-700",
  converted: "bg-green-100 text-green-700",
  lost: "bg-gray-100 text-gray-500",
};

const TRANSITIONS: Record<string, string[]> = {
  new: ["contacted", "lost"],
  contacted: ["qualified", "lost"],
  qualified: ["converted", "lost"],
  lost: ["new"],
};

const TRANSITION_LABELS: Record<string, { label: string; color: string }> = {
  contacted: { label: "Mark Contacted", color: "bg-yellow-600 hover:bg-yellow-700" },
  qualified: { label: "Mark Qualified", color: "bg-purple-600 hover:bg-purple-700" },
  converted: { label: "Convert to Quote", color: "bg-green-600 hover:bg-green-700" },
  lost: { label: "Mark Lost", color: "bg-gray-600 hover:bg-gray-700" },
  new: { label: "Reopen", color: "bg-blue-600 hover:bg-blue-700" },
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
  const [settings, setSettings] = useState<SiteSettingsData>({ currency_symbol: "£", currency_code: "GBP", default_price_per_head: "0.00", target_food_cost_percentage: "30.00" });
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

  if (loading) return <p className="text-gray-500">Loading...</p>;
  if (error && !lead) return <p className="text-red-600">Error: {error}</p>;
  if (!lead) return <p className="text-gray-500">Lead not found.</p>;

  const availableTransitions = TRANSITIONS[lead.status] || [];
  const cs = settings.currency_symbol;

  const setEdit = (field: string) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) =>
    setEditData({ ...editData, [field]: e.target.value });

  return (
    <div>
      <Link href="/leads" className="text-sm text-blue-600 hover:underline mb-4 inline-block">&larr; Back to Leads</Link>

      {error && <p className="text-red-600 mb-4">{error}</p>}

      <div className="bg-white border border-gray-200 rounded-lg p-6 mb-6">
        <div className="flex items-start justify-between mb-4">
          <div>
            <div className="flex items-center gap-3">
              <h1 className="text-2xl font-bold text-gray-900">{lead.contact_name}</h1>
              <span className={`text-sm px-2.5 py-1 rounded ${STATUS_COLORS[lead.status] || ""}`}>
                {lead.status_display}
              </span>
            </div>
            <p className="text-sm text-gray-500 mt-1">
              {lead.event_type_display}
              {lead.event_date && ` \u00b7 ${lead.event_date}`}
              {lead.guest_estimate && ` \u00b7 ${lead.guest_estimate} guests`}
            </p>
          </div>
        </div>

        {editing ? (
          <form onSubmit={handleSave} className="border border-blue-200 bg-blue-50 rounded p-4 mb-4">
            <h3 className="text-sm font-semibold text-gray-900 mb-3">Edit Lead</h3>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Contact Name *</label>
                <input type="text" required value={editData.contact_name} onChange={setEdit("contact_name")} className="w-full border border-gray-300 rounded px-3 py-2 text-sm" />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Account</label>
                <select value={editData.account} onChange={setEdit("account")} className="w-full border border-gray-300 rounded px-3 py-2 text-sm">
                  <option value="">-- No account --</option>
                  {accounts.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
                </select>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Email</label>
                <input type="email" value={editData.contact_email} onChange={setEdit("contact_email")} className="w-full border border-gray-300 rounded px-3 py-2 text-sm" />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Phone</label>
                <input type="text" value={editData.contact_phone} onChange={setEdit("contact_phone")} className="w-full border border-gray-300 rounded px-3 py-2 text-sm" />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Source</label>
                <select value={editData.source} onChange={setEdit("source")} className="w-full border border-gray-300 rounded px-3 py-2 text-sm">
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
                <label className="block text-sm font-medium text-gray-700 mb-1">Event Type</label>
                <select value={editData.event_type} onChange={setEdit("event_type")} className="w-full border border-gray-300 rounded px-3 py-2 text-sm">
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
                <label className="block text-sm font-medium text-gray-700 mb-1">Event Date</label>
                <input type="date" value={editData.event_date} onChange={setEdit("event_date")} className="w-full border border-gray-300 rounded px-3 py-2 text-sm" />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Guest Estimate</label>
                <input type="number" min="1" value={editData.guest_estimate} onChange={setEdit("guest_estimate")} className="w-full border border-gray-300 rounded px-3 py-2 text-sm" />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Budget Range</label>
                <select value={editData.budget_range} onChange={setEdit("budget_range")} className="w-full border border-gray-300 rounded px-3 py-2 text-sm">
                  <option value="">-- Select --</option>
                  {budgetRanges.map((b) => <option key={b.id} value={b.id}>{b.label}</option>)}
                </select>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Service Style</label>
                <select value={editData.service_style} onChange={setEdit("service_style")} className="w-full border border-gray-300 rounded px-3 py-2 text-sm">
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
                <label className="block text-sm font-medium text-gray-700 mb-1">Notes</label>
                <textarea value={editData.notes} onChange={setEdit("notes")} rows={3} className="w-full border border-gray-300 rounded px-3 py-2 text-sm" />
              </div>
              {lead.status === "lost" && (
                <div className="md:col-span-2">
                  <label className="block text-sm font-medium text-gray-700 mb-1">Lost Reason</label>
                  <textarea value={editData.lost_reason} onChange={setEdit("lost_reason")} rows={2} className="w-full border border-gray-300 rounded px-3 py-2 text-sm" />
                </div>
              )}
            </div>
            <div className="flex gap-3 mt-4">
              <button type="submit" disabled={saving} className="bg-blue-600 text-white px-4 py-2 rounded text-sm hover:bg-blue-700 disabled:opacity-50">
                {saving ? "Saving..." : "Save Changes"}
              </button>
              <button type="button" onClick={() => setEditing(false)} className="border border-gray-300 px-4 py-2 rounded text-sm hover:bg-gray-50">
                Cancel
              </button>
            </div>
          </form>
        ) : (
          <>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-sm">
              {lead.contact_email && <div><span className="text-gray-500">Email:</span> {lead.contact_email}</div>}
              {lead.contact_phone && <div><span className="text-gray-500">Phone:</span> {lead.contact_phone}</div>}
              {lead.account_name && <div><span className="text-gray-500">Account:</span> <Link href={`/accounts/${lead.account}`} className="text-blue-600 hover:underline">{lead.account_name}</Link></div>}
              {lead.budget_range_label && <div><span className="text-gray-500">Budget:</span> {lead.budget_range_label}</div>}
              {lead.service_style && <div><span className="text-gray-500">Service:</span> {lead.service_style.replace(/_/g, " ")}</div>}
              <div><span className="text-gray-500">Source:</span> {lead.source.replace(/_/g, " ")}</div>
              {lead.notes && <div className="md:col-span-2"><span className="text-gray-500">Notes:</span> {lead.notes}</div>}
              {lead.lost_reason && <div className="md:col-span-2"><span className="text-gray-500">Lost reason:</span> {lead.lost_reason}</div>}
            </div>

            <div className="mt-4">
              <button onClick={startEditing} className="border border-blue-600 text-blue-600 px-4 py-2 rounded text-sm hover:bg-blue-50">
                Edit Details
              </button>
            </div>
          </>
        )}

        {/* Timeline */}
        <div className="mt-6 border-t border-gray-100 pt-4">
          <h3 className="text-sm font-medium text-gray-700 mb-2">Timeline</h3>
          <div className="text-sm text-gray-500 space-y-1">
            <div>Created: {new Date(lead.created_at).toLocaleString()}</div>
            {lead.contacted_at && <div>Contacted: {new Date(lead.contacted_at).toLocaleString()}</div>}
            {lead.qualified_at && <div>Qualified: {new Date(lead.qualified_at).toLocaleString()}</div>}
            {lead.converted_at && <div>Converted: {new Date(lead.converted_at).toLocaleString()}</div>}
            {lead.lost_at && <div>Lost: {new Date(lead.lost_at).toLocaleString()}</div>}
          </div>
        </div>

      </div>

      {/* Linked Quotes */}
      {lead.quotes && lead.quotes.length > 0 && (
        <div className="bg-white border border-gray-200 rounded-lg p-6 mb-6">
          <h2 className="text-lg font-semibold text-gray-900 mb-4">Quotes</h2>
          <div className="space-y-3">
            {lead.quotes.map((q) => (
              <Link
                key={q.id}
                href={`/quotes/${q.id}`}
                className="flex items-center justify-between p-3 border border-gray-100 rounded hover:bg-gray-50 transition-colors"
              >
                <div className="flex items-center gap-3">
                  <span className="font-medium text-gray-900">Quote #{q.id}</span>
                  <span className={`text-xs px-2 py-0.5 rounded ${
                    q.status === "accepted" ? "bg-green-100 text-green-700" :
                    q.status === "sent" ? "bg-blue-100 text-blue-700" :
                    q.status === "draft" ? "bg-gray-100 text-gray-700" :
                    q.status === "declined" ? "bg-red-100 text-red-700" :
                    "bg-yellow-100 text-yellow-700"
                  }`}>
                    {q.status_display}
                  </span>
                </div>
                <span className="font-semibold text-gray-900">{cs}{q.total}</span>
              </Link>
            ))}
          </div>
        </div>
      )}

      {/* Actions */}
      {availableTransitions.length > 0 && (
        <div className="bg-white border border-gray-200 rounded-lg p-6">
          <h2 className="text-lg font-semibold text-gray-900 mb-4">Actions</h2>
          <div className="flex flex-wrap gap-3">
            {availableTransitions.map((status) => {
              const { label, color } = TRANSITION_LABELS[status] || { label: status, color: "bg-gray-600" };
              return (
                <button
                  key={status}
                  onClick={() => handleTransition(status)}
                  disabled={transitioning}
                  className={`text-white px-4 py-2 rounded text-sm disabled:opacity-50 ${color}`}
                >
                  {transitioning ? "..." : label}
                </button>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
