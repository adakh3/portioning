"use client";

import { useEffect, useState, useCallback } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import { api, Quote, Venue, Contact, SiteSettingsData } from "@/lib/api";
import MenuBuilder from "@/components/MenuBuilder";

const STATUS_COLORS: Record<string, string> = {
  draft: "bg-gray-100 text-gray-700",
  sent: "bg-blue-100 text-blue-700",
  accepted: "bg-green-100 text-green-700",
  expired: "bg-yellow-100 text-yellow-700",
  declined: "bg-red-100 text-red-700",
};

const CATEGORY_LABELS: Record<string, string> = {
  food: "Food",
  beverage: "Beverage",
  rental: "Rental",
  labor: "Labour",
  fee: "Fee",
  discount: "Discount",
};

export default function QuoteDetailPage() {
  const { id } = useParams();
  const [quote, setQuote] = useState<Quote | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [showItemForm, setShowItemForm] = useState(false);
  const [saving, setSaving] = useState(false);
  const [editing, setEditing] = useState(false);
  const [venues, setVenues] = useState<Venue[]>([]);
  const [contacts, setContacts] = useState<Contact[]>([]);
  const [settings, setSettings] = useState<SiteSettingsData>({ currency_symbol: "£", currency_code: "GBP", default_price_per_head: "0.00", target_food_cost_percentage: "30.00", price_rounding_step: "50" });
  const [editData, setEditData] = useState({
    primary_contact: "",
    event_date: "",
    guest_count: "",
    price_per_head: "",
    venue: "",
    venue_address: "",
    event_type: "",
    service_style: "",
    tax_rate: "",
    valid_until: "",
    notes: "",
    internal_notes: "",
  });
  const [suggestedPrice, setSuggestedPrice] = useState<number | null>(null);
  const handleSuggestedPriceChange = useCallback((price: number | null) => setSuggestedPrice(price), []);
  const [itemData, setItemData] = useState({
    category: "food",
    description: "",
    quantity: "1",
    unit: "each",
    unit_price: "",
    is_taxable: true,
    sort_order: 0,
  });

  useEffect(() => {
    api.getQuote(Number(id))
      .then(setQuote)
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
    api.getSiteSettings().then(setSettings).catch(() => {});
  }, [id]);

  function startEditing() {
    if (!quote) return;
    setEditData({
      primary_contact: quote.primary_contact ? String(quote.primary_contact) : "",
      event_date: quote.event_date,
      guest_count: String(quote.guest_count),
      price_per_head: quote.price_per_head || "",
      venue: quote.venue ? String(quote.venue) : "",
      venue_address: quote.venue_address || "",
      event_type: quote.event_type,
      service_style: quote.service_style || "",
      tax_rate: String(Math.round(parseFloat(quote.tax_rate) * 10000) / 100),
      valid_until: quote.valid_until || "",
      notes: quote.notes,
      internal_notes: quote.internal_notes,
    });
    api.getVenues().then(setVenues).catch(() => {});
    if (quote.account) {
      api.getAccount(quote.account).then((acct) => setContacts(acct.contacts || [])).catch(() => {});
    }
    setEditing(true);
  }

  async function handleSaveDetails(e: React.FormEvent) {
    e.preventDefault();
    if (!quote) return;
    setSaving(true);
    setError("");
    try {
      const updated = await api.updateQuote(quote.id, {
        primary_contact: editData.primary_contact ? Number(editData.primary_contact) : null,
        event_date: editData.event_date,
        guest_count: Number(editData.guest_count),
        price_per_head: editData.price_per_head ? editData.price_per_head : null,
        venue: editData.venue ? Number(editData.venue) : null,
        venue_address: editData.venue_address,
        event_type: editData.event_type,
        service_style: editData.service_style || undefined,
        tax_rate: (parseFloat(editData.tax_rate) / 100).toFixed(4),
        valid_until: editData.valid_until || null,
        notes: editData.notes,
        internal_notes: editData.internal_notes,
      });
      setQuote(updated);
      setEditing(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to save");
    } finally {
      setSaving(false);
    }
  }

  async function handleAddItem(e: React.FormEvent) {
    e.preventDefault();
    if (!quote) return;
    setSaving(true);
    setError("");
    try {
      await api.createQuoteLineItem(quote.id, {
        ...itemData,
        quantity: itemData.quantity,
        unit_price: itemData.unit_price,
        sort_order: itemData.sort_order,
      });
      const updated = await api.getQuote(quote.id);
      setQuote(updated);
      setShowItemForm(false);
      setItemData({ category: "food", description: "", quantity: "1", unit: "each", unit_price: "", is_taxable: true, sort_order: 0 });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to add item");
    } finally {
      setSaving(false);
    }
  }

  async function handleDeleteItem(itemId: number) {
    if (!quote || !confirm("Remove this line item?")) return;
    try {
      await api.deleteQuoteLineItem(quote.id, itemId);
      const updated = await api.getQuote(quote.id);
      setQuote(updated);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to delete item");
    }
  }

  async function handleTransition(newStatus: string) {
    if (!quote) return;
    setSaving(true);
    setError("");
    try {
      const updated = await api.transitionQuote(quote.id, newStatus);
      setQuote(updated);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to update status");
    } finally {
      setSaving(false);
    }
  }

  if (loading) return <p className="text-gray-500">Loading...</p>;
  if (error && !quote) return <p className="text-red-600">Error: {error}</p>;
  if (!quote) return <p className="text-gray-500">Quote not found.</p>;

  const cs = settings.currency_symbol;

  const setEdit = (field: string) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) =>
    setEditData({ ...editData, [field]: e.target.value });

  return (
    <div className="space-y-6">
      {/* Breadcrumb */}
      <div className="flex items-center gap-2 text-sm">
        <Link href="/quotes" className="text-blue-600 hover:underline">&larr; Quotes</Link>
        {quote.lead && quote.lead_name && (
          <>
            <span className="text-gray-400">&middot;</span>
            <span className="text-gray-500">From Lead:</span>
            <Link href={`/leads/${quote.lead}`} className="text-blue-600 hover:underline">{quote.lead_name}</Link>
          </>
        )}
      </div>

      {error && <p className="text-red-600">{error}</p>}

      {/* Header */}
      <div className="bg-white border border-gray-200 rounded-lg p-6">
        <div className="flex items-start justify-between">
          <div>
            <div className="flex items-center gap-3">
              <h1 className="text-2xl font-bold text-gray-900">Quote #{quote.id} v{quote.version}</h1>
              <span className={`text-sm px-2.5 py-1 rounded ${STATUS_COLORS[quote.status] || ""}`}>
                {quote.status_display}
              </span>
            </div>
            <p className="text-sm text-gray-500 mt-1">
              Created {new Date(quote.created_at).toLocaleDateString()}
              {quote.sent_at && ` · Sent ${new Date(quote.sent_at).toLocaleDateString()}`}
              {quote.accepted_at && ` · Accepted ${new Date(quote.accepted_at).toLocaleDateString()}`}
            </p>
          </div>
          <div className="text-right">
            <p className="text-2xl font-bold text-gray-900">{cs}{quote.total}</p>
            <p className="text-xs text-gray-500">Subtotal: {cs}{quote.subtotal} + Tax: {cs}{quote.tax_amount}</p>
          </div>
        </div>

        {/* Actions */}
        <div className="mt-4 pt-4 border-t border-gray-100 flex flex-wrap gap-3">
          {!editing && (
            <button onClick={startEditing} className="border border-blue-600 text-blue-600 px-4 py-2 rounded text-sm hover:bg-blue-50">
              Edit Details
            </button>
          )}
          <button
            onClick={async () => {
              try {
                const blob = await api.downloadQuotePDF(quote.id);
                const url = URL.createObjectURL(blob);
                const a = document.createElement("a");
                a.href = url;
                a.download = `Quote-${quote.id}-v${quote.version}.pdf`;
                a.click();
                URL.revokeObjectURL(url);
              } catch (err) {
                setError(err instanceof Error ? err.message : "Failed to download PDF");
              }
            }}
            className="border border-gray-300 text-gray-700 px-4 py-2 rounded text-sm hover:bg-gray-50"
          >
            Download PDF
          </button>
          {quote.status === "draft" && (
            <>
              <button onClick={() => handleTransition("sent")} disabled={saving} className="bg-blue-600 text-white px-4 py-2 rounded text-sm hover:bg-blue-700 disabled:opacity-50">
                {saving ? "..." : "Mark as Sent"}
              </button>
              <button onClick={() => handleTransition("accepted")} disabled={saving} className="bg-green-600 text-white px-4 py-2 rounded text-sm hover:bg-green-700 disabled:opacity-50">
                {saving ? "..." : "Accept & Create Event"}
              </button>
            </>
          )}
          {quote.status === "sent" && (
            <>
              <button onClick={() => handleTransition("accepted")} disabled={saving} className="bg-green-600 text-white px-4 py-2 rounded text-sm hover:bg-green-700 disabled:opacity-50">
                {saving ? "..." : "Accept & Create Event"}
              </button>
              <button onClick={() => handleTransition("declined")} disabled={saving} className="border border-red-300 text-red-600 px-4 py-2 rounded text-sm hover:bg-red-50 disabled:opacity-50">
                {saving ? "..." : "Declined"}
              </button>
              <button onClick={() => handleTransition("draft")} disabled={saving} className="border border-gray-300 px-4 py-2 rounded text-sm hover:bg-gray-50 disabled:opacity-50">
                {saving ? "..." : "Back to Draft"}
              </button>
            </>
          )}
          {(quote.status === "expired" || quote.status === "declined") && (
            <button onClick={() => handleTransition("draft")} disabled={saving} className="border border-gray-300 px-4 py-2 rounded text-sm hover:bg-gray-50 disabled:opacity-50">
              {saving ? "..." : "Reopen as Draft"}
            </button>
          )}
        </div>

        {/* Event link when accepted */}
        {quote.status === "accepted" && quote.event_id && (
          <div className="mt-4 p-3 bg-green-50 border border-green-200 rounded flex items-center justify-between">
            <span className="text-green-800 text-sm">Event created from this quote</span>
            <Link href={`/events/${quote.event_id}`} className="text-green-700 font-medium text-sm hover:underline">
              View Event &rarr;
            </Link>
          </div>
        )}
      </div>

      {/* Edit Form (shown when editing) */}
      {editing && (
        <form onSubmit={handleSaveDetails} className="bg-blue-50 border border-blue-200 rounded-lg p-6">
          <h2 className="text-lg font-semibold text-gray-900 mb-4">Edit Quote Details</h2>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Contact Person</label>
              <select value={editData.primary_contact} onChange={setEdit("primary_contact")} className="w-full border border-gray-300 rounded px-3 py-2 text-sm">
                <option value="">-- No contact --</option>
                {contacts.map((c) => <option key={c.id} value={c.id}>{c.name} ({c.role})</option>)}
              </select>
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Event Date</label>
              <input type="date" required value={editData.event_date} onChange={setEdit("event_date")} className="w-full border border-gray-300 rounded px-3 py-2 text-sm" />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Guest Count</label>
              <input type="number" required min="1" value={editData.guest_count} onChange={setEdit("guest_count")} className="w-full border border-gray-300 rounded px-3 py-2 text-sm" />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Price Per Head ({cs})</label>
              <div className="flex gap-2">
                <input type="number" step="0.01" min="0" value={editData.price_per_head} onChange={setEdit("price_per_head")} placeholder="0.00" className="w-full border border-gray-300 rounded px-3 py-2 text-sm" />
                {suggestedPrice !== null && (
                  <button
                    type="button"
                    onClick={() => setEditData({ ...editData, price_per_head: suggestedPrice.toFixed(2) })}
                    className="whitespace-nowrap border border-green-300 text-green-700 bg-green-50 px-3 py-2 rounded text-sm hover:bg-green-100"
                  >
                    Use {cs}{suggestedPrice.toFixed(2)}
                  </button>
                )}
              </div>
              {suggestedPrice !== null && (
                <p className="text-xs text-green-600 mt-1">
                  Suggested: {cs}{suggestedPrice.toFixed(2)}/head
                </p>
              )}
              {editData.price_per_head && editData.guest_count && (
                <p className="text-xs text-gray-500 mt-1">
                  Food total: {cs}{(parseFloat(editData.price_per_head) * Number(editData.guest_count)).toFixed(2)}
                </p>
              )}
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
              <label className="block text-sm font-medium text-gray-700 mb-1">Service Style</label>
              <select value={editData.service_style} onChange={setEdit("service_style")} className="w-full border border-gray-300 rounded px-3 py-2 text-sm">
                <option value="">-- None --</option>
                <option value="buffet">Buffet</option>
                <option value="plated">Plated / Sit-down</option>
                <option value="stations">Food Stations</option>
                <option value="family_style">Family Style</option>
                <option value="boxed">Boxed / Individual</option>
                <option value="canapes">Canapes</option>
                <option value="mixed">Mixed Service</option>
              </select>
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Venue</label>
              <select value={editData.venue} onChange={setEdit("venue")} className="w-full border border-gray-300 rounded px-3 py-2 text-sm">
                <option value="">-- No venue --</option>
                {venues.map((v) => <option key={v.id} value={v.id}>{v.name}</option>)}
              </select>
            </div>
            <div className="md:col-span-2">
              <label className="block text-sm font-medium text-gray-700 mb-1">Venue Address / Notes</label>
              <textarea value={editData.venue_address} onChange={setEdit("venue_address")} rows={2} placeholder="Freeform address or additional venue notes" className="w-full border border-gray-300 rounded px-3 py-2 text-sm" />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Tax Rate (%)</label>
              <input type="number" step="0.01" min="0" max="100" value={editData.tax_rate} onChange={setEdit("tax_rate")} className="w-full border border-gray-300 rounded px-3 py-2 text-sm" />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Valid Until</label>
              <input type="date" value={editData.valid_until} onChange={setEdit("valid_until")} className="w-full border border-gray-300 rounded px-3 py-2 text-sm" />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Notes (customer-visible)</label>
              <textarea value={editData.notes} onChange={setEdit("notes")} rows={2} className="w-full border border-gray-300 rounded px-3 py-2 text-sm" />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Internal Notes</label>
              <textarea value={editData.internal_notes} onChange={setEdit("internal_notes")} rows={2} className="w-full border border-gray-300 rounded px-3 py-2 text-sm" />
            </div>
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
      )}

      {/* Customer & Venue (always visible) */}
      {!editing && (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          <div className="bg-white border border-gray-200 rounded-lg p-6">
            <h2 className="text-sm font-semibold text-gray-500 uppercase tracking-wide mb-3">Customer</h2>
            <div className="space-y-2 text-sm">
              <div>
                <span className="text-gray-500">Account:</span>{" "}
                <Link href={`/accounts/${quote.account}`} className="text-blue-600 hover:underline font-medium">{quote.account_name}</Link>
              </div>
              {quote.contact_name ? (
                <div>
                  <span className="text-gray-500">Contact:</span> {quote.contact_name}
                  {quote.contact_email && (
                    <span className="text-gray-500 ml-2">{quote.contact_email}</span>
                  )}
                  {quote.contact_phone && (
                    <span className="text-gray-500 ml-2">{quote.contact_phone}</span>
                  )}
                </div>
              ) : (
                <div className="text-gray-400 italic">No contact person set</div>
              )}
            </div>
          </div>

          <div className="bg-white border border-gray-200 rounded-lg p-6">
            <h2 className="text-sm font-semibold text-gray-500 uppercase tracking-wide mb-3">Venue</h2>
            <div className="space-y-2 text-sm">
              {quote.venue_name ? (
                <div><span className="text-gray-500">Venue:</span> <span className="font-medium">{quote.venue_name}</span></div>
              ) : !quote.venue_address ? (
                <div className="text-gray-400 italic">No venue set</div>
              ) : null}
              {quote.venue_address && (
                <div><span className="text-gray-500">Address:</span> {quote.venue_address}</div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Event Details (always visible) */}
      {!editing && (
        <div className="bg-white border border-gray-200 rounded-lg p-6">
          <h2 className="text-sm font-semibold text-gray-500 uppercase tracking-wide mb-3">Event Details</h2>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-sm">
            <div>
              <span className="text-gray-500 block">Date</span>
              <span className="font-medium text-gray-900">{quote.event_date}</span>
            </div>
            <div>
              <span className="text-gray-500 block">Guests</span>
              <span className="font-medium text-gray-900">{quote.guest_count}</span>
            </div>
            <div>
              <span className="text-gray-500 block">Event Type</span>
              <span className="font-medium text-gray-900 capitalize">{quote.event_type.replace(/_/g, " ")}</span>
            </div>
            <div>
              <span className="text-gray-500 block">Service Style</span>
              <span className="font-medium text-gray-900 capitalize">{quote.service_style ? quote.service_style.replace(/_/g, " ") : "—"}</span>
            </div>
            <div>
              <span className="text-gray-500 block">Price Per Head</span>
              <span className="font-medium text-gray-900">{quote.price_per_head ? `${cs}${quote.price_per_head}` : "—"}</span>
            </div>
            <div>
              <span className="text-gray-500 block">Tax Rate</span>
              <span className="font-medium text-gray-900">{(parseFloat(quote.tax_rate) * 100).toFixed(0)}%</span>
            </div>
            <div>
              <span className="text-gray-500 block">Valid Until</span>
              <span className="font-medium text-gray-900">{quote.valid_until || "—"}</span>
            </div>
          </div>
          {(quote.notes || quote.internal_notes) && (
            <div className="mt-4 pt-4 border-t border-gray-100 grid grid-cols-1 md:grid-cols-2 gap-4 text-sm">
              {quote.notes && (
                <div>
                  <span className="text-gray-500 block mb-1">Notes (customer-visible)</span>
                  <p className="text-gray-900">{quote.notes}</p>
                </div>
              )}
              {quote.internal_notes && (
                <div>
                  <span className="text-gray-500 block mb-1">Internal Notes</span>
                  <p className="text-gray-700 italic">{quote.internal_notes}</p>
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {/* Menu */}
      <div className="bg-white border border-gray-200 rounded-lg p-6">
        <h2 className="text-sm font-semibold text-gray-500 uppercase tracking-wide mb-3">Menu</h2>
        <MenuBuilder
          selectedDishIds={quote.dishes || []}
          basedOnTemplate={quote.based_on_template || null}
          guestCount={editing && editData.guest_count ? Number(editData.guest_count) : quote.guest_count}
          onSave={async (data) => {
            const updated = await api.updateQuote(quote.id, {
              dish_ids: data.dish_ids,
              based_on_template: data.based_on_template,
            });
            setQuote(updated);
          }}
          onSuggestedPriceChange={handleSuggestedPriceChange}
          onUseSuggestedPrice={(price) => setEditData((prev) => ({ ...prev, price_per_head: price.toFixed(2) }))}
          currencySymbol={cs}
          priceRoundingStep={Number(settings.price_rounding_step) || 50}
        />
      </div>

      {/* Line Items */}
      <div className="bg-white border border-gray-200 rounded-lg p-6">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-sm font-semibold text-gray-500 uppercase tracking-wide">Line Items</h2>
          <button onClick={() => setShowItemForm(!showItemForm)} className="bg-blue-600 text-white px-3 py-1.5 rounded text-sm hover:bg-blue-700">
            {showItemForm ? "Cancel" : "Add Item"}
          </button>
        </div>

        {showItemForm && (
          <form onSubmit={handleAddItem} className="border border-gray-200 rounded p-4 mb-4">
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Category</label>
                <select value={itemData.category} onChange={(e) => setItemData({ ...itemData, category: e.target.value })} className="w-full border border-gray-300 rounded px-3 py-2 text-sm">
                  <option value="food">Food</option>
                  <option value="beverage">Beverage</option>
                  <option value="rental">Rental</option>
                  <option value="labor">Labour</option>
                  <option value="fee">Fee</option>
                  <option value="discount">Discount</option>
                </select>
              </div>
              <div className="md:col-span-2">
                <label className="block text-sm font-medium text-gray-700 mb-1">Description</label>
                <input type="text" required value={itemData.description} onChange={(e) => setItemData({ ...itemData, description: e.target.value })} className="w-full border border-gray-300 rounded px-3 py-2 text-sm" />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Quantity</label>
                <input type="number" step="0.01" min="0" required value={itemData.quantity} onChange={(e) => setItemData({ ...itemData, quantity: e.target.value })} className="w-full border border-gray-300 rounded px-3 py-2 text-sm" />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Unit</label>
                <select value={itemData.unit} onChange={(e) => setItemData({ ...itemData, unit: e.target.value })} className="w-full border border-gray-300 rounded px-3 py-2 text-sm">
                  <option value="each">Each</option>
                  <option value="per_guest">Per Guest</option>
                  <option value="per_hour">Per Hour</option>
                  <option value="flat">Flat Rate</option>
                </select>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Unit Price ({cs})</label>
                <input type="number" step="0.01" min="0" required value={itemData.unit_price} onChange={(e) => setItemData({ ...itemData, unit_price: e.target.value })} className="w-full border border-gray-300 rounded px-3 py-2 text-sm" />
              </div>
              <div className="flex items-center gap-2 mt-6">
                <input type="checkbox" checked={itemData.is_taxable} onChange={(e) => setItemData({ ...itemData, is_taxable: e.target.checked })} className="rounded border-gray-300" />
                <label className="text-sm text-gray-700">Taxable</label>
              </div>
            </div>
            <button type="submit" disabled={saving} className="mt-4 bg-green-600 text-white px-4 py-2 rounded text-sm hover:bg-green-700 disabled:opacity-50">
              {saving ? "Adding..." : "Add Item"}
            </button>
          </form>
        )}

        {quote.line_items.length === 0 && parseFloat(quote.food_total) === 0 ? (
          <p className="text-gray-500 text-sm">No line items yet. Click "Add Item" to start building this quote.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-gray-200 text-left text-gray-500">
                  <th className="pb-2 font-medium">Category</th>
                  <th className="pb-2 font-medium">Description</th>
                  <th className="pb-2 font-medium text-right">Qty</th>
                  <th className="pb-2 font-medium">Unit</th>
                  <th className="pb-2 font-medium text-right">Price</th>
                  <th className="pb-2 font-medium text-right">Total</th>
                  <th className="pb-2"></th>
                </tr>
              </thead>
              <tbody>
                {quote.line_items.map((item) => (
                  <tr key={item.id} className="border-b border-gray-100">
                    <td className="py-2">
                      <span className="text-xs bg-gray-100 text-gray-600 px-2 py-0.5 rounded">
                        {CATEGORY_LABELS[item.category] || item.category}
                      </span>
                    </td>
                    <td className="py-2 text-gray-900">{item.description}</td>
                    <td className="py-2 text-right text-gray-700">{item.quantity}</td>
                    <td className="py-2 text-gray-500">{item.unit.replace(/_/g, " ")}</td>
                    <td className="py-2 text-right text-gray-700">{cs}{item.unit_price}</td>
                    <td className="py-2 text-right font-medium text-gray-900">{cs}{item.line_total}</td>
                    <td className="py-2 text-right">
                      <button onClick={() => handleDeleteItem(item.id)} className="text-red-500 hover:text-red-700 text-xs">
                        Remove
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                {parseFloat(quote.food_total) > 0 && (
                  <tr className="border-t border-gray-200">
                    <td colSpan={5} className="pt-3 text-right text-gray-500">
                      Food ({cs}{quote.price_per_head} x {quote.guest_count} guests)
                    </td>
                    <td className="pt-3 text-right font-medium">{cs}{quote.food_total}</td>
                    <td></td>
                  </tr>
                )}
                <tr className={parseFloat(quote.food_total) > 0 ? "" : "border-t border-gray-200"}>
                  <td colSpan={5} className="pt-3 text-right text-gray-500">Subtotal</td>
                  <td className="pt-3 text-right font-medium">{cs}{quote.subtotal}</td>
                  <td></td>
                </tr>
                <tr>
                  <td colSpan={5} className="py-1 text-right text-gray-500">VAT ({(parseFloat(quote.tax_rate) * 100).toFixed(0)}%)</td>
                  <td className="py-1 text-right">{cs}{quote.tax_amount}</td>
                  <td></td>
                </tr>
                <tr className="border-t border-gray-300">
                  <td colSpan={5} className="pt-2 text-right font-semibold text-gray-900">Total</td>
                  <td className="pt-2 text-right font-bold text-lg text-gray-900">{cs}{quote.total}</td>
                  <td></td>
                </tr>
              </tfoot>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
