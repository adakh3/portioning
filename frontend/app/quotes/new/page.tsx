"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { api, Account, Contact, Venue, SiteSettingsData } from "@/lib/api";
import MenuBuilder from "@/components/MenuBuilder";

export default function NewQuotePage() {
  const router = useRouter();
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [contacts, setContacts] = useState<Contact[]>([]);
  const [venues, setVenues] = useState<Venue[]>([]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [settings, setSettings] = useState<SiteSettingsData>({ currency_symbol: "£", currency_code: "GBP", default_price_per_head: "0.00" });
  const [formData, setFormData] = useState({
    account: "",
    primary_contact: "",
    venue: "",
    venue_address: "",
    event_date: "",
    guest_count: "",
    price_per_head: "",
    event_type: "other",
    service_style: "",
    tax_rate: "0.2000",
    valid_until: "",
    notes: "",
    internal_notes: "",
  });
  const [menuData, setMenuData] = useState<{
    dish_ids: number[];
    based_on_template: number | null;
  }>({ dish_ids: [], based_on_template: null });

  useEffect(() => {
    Promise.all([api.getAccounts(), api.getVenues(), api.getSiteSettings()])
      .then(([a, v, s]) => {
        setAccounts(a);
        setVenues(v);
        setSettings(s);
        if (parseFloat(s.default_price_per_head) > 0) {
          setFormData((prev) => ({ ...prev, price_per_head: s.default_price_per_head }));
        }
      })
      .catch(() => {});
  }, []);

  // Load contacts when account changes
  useEffect(() => {
    if (formData.account) {
      const acct = accounts.find((a) => a.id === Number(formData.account));
      setContacts(acct?.contacts || []);
      setFormData((prev) => ({ ...prev, primary_contact: "" }));
    } else {
      setContacts([]);
    }
  }, [formData.account, accounts]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    setError("");
    try {
      const data = {
        account: Number(formData.account),
        primary_contact: formData.primary_contact ? Number(formData.primary_contact) : null,
        venue: formData.venue ? Number(formData.venue) : null,
        venue_address: formData.venue_address,
        event_date: formData.event_date,
        guest_count: Number(formData.guest_count),
        price_per_head: formData.price_per_head ? formData.price_per_head : null,
        event_type: formData.event_type,
        service_style: formData.service_style || undefined,
        tax_rate: formData.tax_rate,
        valid_until: formData.valid_until || null,
        notes: formData.notes,
        internal_notes: formData.internal_notes,
        dish_ids: menuData.dish_ids,
        based_on_template: menuData.based_on_template,
      };
      const quote = await api.createQuote(data);
      router.push(`/quotes/${quote.id}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to create quote");
      setSaving(false);
    }
  }

  const set = (field: string) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) =>
    setFormData({ ...formData, [field]: e.target.value });

  const venueSelected = !!formData.venue;

  return (
    <div>
      <Link href="/quotes" className="text-sm text-blue-600 hover:underline mb-4 inline-block">&larr; Back to Quotes</Link>
      <h1 className="text-2xl font-bold text-gray-900 mb-6">New Quote</h1>

      {error && <p className="text-red-600 mb-4">{error}</p>}

      <form onSubmit={handleSubmit} className="space-y-6">
        {/* Customer & Contact */}
        <div className="bg-white border border-gray-200 rounded-lg p-6">
          <h2 className="text-lg font-semibold text-gray-900 mb-4">Customer</h2>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Account *</label>
              <select required value={formData.account} onChange={set("account")} className="w-full border border-gray-300 rounded px-3 py-2 text-sm">
                <option value="">-- Select Account --</option>
                {accounts.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
              </select>
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Contact Person</label>
              <select value={formData.primary_contact} onChange={set("primary_contact")} disabled={!formData.account} className="w-full border border-gray-300 rounded px-3 py-2 text-sm disabled:bg-gray-100">
                <option value="">-- Select Contact --</option>
                {contacts.map((c) => <option key={c.id} value={c.id}>{c.name} ({c.role})</option>)}
              </select>
              {formData.account && contacts.length === 0 && (
                <p className="text-xs text-gray-400 mt-1">No contacts on this account</p>
              )}
            </div>
          </div>
        </div>

        {/* Event Details */}
        <div className="bg-white border border-gray-200 rounded-lg p-6">
          <h2 className="text-lg font-semibold text-gray-900 mb-4">Event Details</h2>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Event Date *</label>
              <input type="date" required value={formData.event_date} onChange={set("event_date")} className="w-full border border-gray-300 rounded px-3 py-2 text-sm" />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Guest Count *</label>
              <input type="number" required min="1" value={formData.guest_count} onChange={set("guest_count")} className="w-full border border-gray-300 rounded px-3 py-2 text-sm" />
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
          </div>
        </div>

        {/* Venue */}
        <div className="bg-white border border-gray-200 rounded-lg p-6">
          <h2 className="text-lg font-semibold text-gray-900 mb-4">Venue</h2>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Saved Venue</label>
              <select value={formData.venue} onChange={set("venue")} className="w-full border border-gray-300 rounded px-3 py-2 text-sm">
                <option value="">-- No saved venue --</option>
                {venues.map((v) => <option key={v.id} value={v.id}>{v.name} — {v.city}</option>)}
              </select>
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                {venueSelected ? "Additional Address Notes" : "Venue Address (freeform)"}
              </label>
              <textarea
                value={formData.venue_address}
                onChange={set("venue_address")}
                rows={2}
                placeholder={venueSelected ? "e.g. Use the garden entrance" : "e.g. 42 Oak Lane, Manchester, M1 2AB"}
                className="w-full border border-gray-300 rounded px-3 py-2 text-sm"
              />
            </div>
          </div>
        </div>

        {/* Menu */}
        <div className="bg-white border border-gray-200 rounded-lg p-6">
          <h2 className="text-lg font-semibold text-gray-900 mb-4">Menu</h2>
          <MenuBuilder
            selectedDishIds={menuData.dish_ids}
            basedOnTemplate={menuData.based_on_template}
            onChange={setMenuData}
          />
        </div>

        {/* Pricing & Terms */}
        <div className="bg-white border border-gray-200 rounded-lg p-6">
          <h2 className="text-lg font-semibold text-gray-900 mb-4">Pricing & Terms</h2>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Price Per Head ({settings.currency_symbol})</label>
              <input
                type="number"
                step="0.01"
                min="0"
                value={formData.price_per_head}
                onChange={set("price_per_head")}
                placeholder="0.00"
                className="w-full border border-gray-300 rounded px-3 py-2 text-sm"
              />
              {formData.price_per_head && formData.guest_count && (
                <p className="text-xs text-gray-500 mt-1">
                  Food total: {settings.currency_symbol}{(parseFloat(formData.price_per_head) * Number(formData.guest_count)).toFixed(2)} ({formData.guest_count} guests)
                </p>
              )}
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Tax Rate (%)</label>
              <input
                type="number"
                step="0.01"
                min="0"
                max="100"
                value={Math.round(parseFloat(formData.tax_rate) * 10000) / 100}
                onChange={(e) => setFormData({ ...formData, tax_rate: (parseFloat(e.target.value) / 100).toFixed(4) })}
                className="w-full border border-gray-300 rounded px-3 py-2 text-sm"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Valid Until</label>
              <input type="date" value={formData.valid_until} onChange={set("valid_until")} className="w-full border border-gray-300 rounded px-3 py-2 text-sm" />
            </div>
          </div>
        </div>

        {/* Notes */}
        <div className="bg-white border border-gray-200 rounded-lg p-6">
          <h2 className="text-lg font-semibold text-gray-900 mb-4">Notes</h2>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Notes (customer-visible)</label>
              <textarea value={formData.notes} onChange={set("notes")} rows={3} className="w-full border border-gray-300 rounded px-3 py-2 text-sm" />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Internal Notes</label>
              <textarea value={formData.internal_notes} onChange={set("internal_notes")} rows={3} className="w-full border border-gray-300 rounded px-3 py-2 text-sm" />
            </div>
          </div>
        </div>

        <button type="submit" disabled={saving} className="bg-green-600 text-white px-6 py-2 rounded text-sm hover:bg-green-700 disabled:opacity-50">
          {saving ? "Creating..." : "Create Quote"}
        </button>
      </form>
    </div>
  );
}
