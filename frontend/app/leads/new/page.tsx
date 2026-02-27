"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { api, Account, BudgetRangeOption } from "@/lib/api";

export default function NewLeadPage() {
  const router = useRouter();
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [budgetRanges, setBudgetRanges] = useState<BudgetRangeOption[]>([]);
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
    budget_range: "" as string | number,
    event_type: "other",
    service_style: "",
    notes: "",
  });

  useEffect(() => {
    api.getAccounts().then(setAccounts).catch(() => {});
    api.getBudgetRanges().then(setBudgetRanges).catch(() => {});
  }, []);

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
        budget_range: formData.budget_range ? Number(formData.budget_range) : null,
      };
      const lead = await api.createLead(data);
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
      <Link href="/leads" className="text-sm text-blue-600 hover:underline mb-4 inline-block">&larr; Back to Leads</Link>
      <h1 className="text-2xl font-bold text-gray-900 mb-6">New Lead</h1>

      {error && <p className="text-red-600 mb-4">{error}</p>}

      <form onSubmit={handleSubmit} className="bg-white border border-gray-200 rounded-lg p-6">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Contact Name *</label>
            <input type="text" required value={formData.contact_name} onChange={set("contact_name")} className="w-full border border-gray-300 rounded px-3 py-2 text-sm" />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Account (optional)</label>
            <select value={formData.account} onChange={set("account")} className="w-full border border-gray-300 rounded px-3 py-2 text-sm">
              <option value="">-- No account --</option>
              {accounts.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
            </select>
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Email</label>
            <input type="email" value={formData.contact_email} onChange={set("contact_email")} className="w-full border border-gray-300 rounded px-3 py-2 text-sm" />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Phone</label>
            <input type="text" value={formData.contact_phone} onChange={set("contact_phone")} className="w-full border border-gray-300 rounded px-3 py-2 text-sm" />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Source</label>
            <select value={formData.source} onChange={set("source")} className="w-full border border-gray-300 rounded px-3 py-2 text-sm">
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
            <select value={formData.event_type} onChange={set("event_type")} className="w-full border border-gray-300 rounded px-3 py-2 text-sm">
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
            <input type="date" value={formData.event_date} onChange={set("event_date")} className="w-full border border-gray-300 rounded px-3 py-2 text-sm" />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Guest Estimate</label>
            <input type="number" min="1" value={formData.guest_estimate} onChange={set("guest_estimate")} className="w-full border border-gray-300 rounded px-3 py-2 text-sm" />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Budget Range</label>
            <select value={formData.budget_range} onChange={set("budget_range")} className="w-full border border-gray-300 rounded px-3 py-2 text-sm">
              <option value="">-- Select --</option>
              {budgetRanges.map((b) => <option key={b.id} value={b.id}>{b.label}</option>)}
            </select>
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Service Style</label>
            <select value={formData.service_style} onChange={set("service_style")} className="w-full border border-gray-300 rounded px-3 py-2 text-sm">
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
            <textarea value={formData.notes} onChange={set("notes")} rows={3} className="w-full border border-gray-300 rounded px-3 py-2 text-sm" />
          </div>
        </div>
        <button type="submit" disabled={saving} className="mt-6 bg-green-600 text-white px-6 py-2 rounded text-sm hover:bg-green-700 disabled:opacity-50">
          {saving ? "Creating..." : "Create Lead"}
        </button>
      </form>
    </div>
  );
}
