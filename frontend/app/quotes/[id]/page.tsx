"use client";

import { useEffect, useState, useCallback } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import { api, Quote, Venue, Contact, SiteSettingsData } from "@/lib/api";
import MenuBuilder from "@/components/MenuBuilder";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";

const STATUS_BADGE_VARIANT: Record<string, "secondary" | "info" | "success" | "warning" | "destructive"> = {
  draft: "secondary",
  sent: "info",
  accepted: "success",
  expired: "warning",
  declined: "destructive",
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

  if (loading) return <p className="text-muted-foreground">Loading...</p>;
  if (error && !quote) return <p className="text-destructive">Error: {error}</p>;
  if (!quote) return <p className="text-muted-foreground">Quote not found.</p>;

  const cs = settings.currency_symbol;

  const setEdit = (field: string) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) =>
    setEditData({ ...editData, [field]: e.target.value });

  return (
    <div className="space-y-6">
      {/* Breadcrumb */}
      <div className="flex items-center gap-2 text-sm">
        <Link href="/quotes" className="text-primary hover:underline">&larr; Quotes</Link>
        {quote.lead && quote.lead_name && (
          <>
            <span className="text-muted-foreground">&middot;</span>
            <span className="text-muted-foreground">From Lead:</span>
            <Link href={`/leads/${quote.lead}`} className="text-primary hover:underline">{quote.lead_name}</Link>
          </>
        )}
      </div>

      {error && <p className="text-destructive">{error}</p>}

      {/* Header */}
      <Card>
        <CardContent className="p-6">
          <div className="flex items-start justify-between">
            <div>
              <div className="flex items-center gap-3">
                <h1 className="text-2xl font-bold text-foreground">Quote #{quote.id} v{quote.version}</h1>
                <Badge variant={STATUS_BADGE_VARIANT[quote.status] || "secondary"}>
                  {quote.status_display}
                </Badge>
              </div>
              <p className="text-sm text-muted-foreground mt-1">
                Created {new Date(quote.created_at).toLocaleDateString()}
                {quote.sent_at && ` · Sent ${new Date(quote.sent_at).toLocaleDateString()}`}
                {quote.accepted_at && ` · Accepted ${new Date(quote.accepted_at).toLocaleDateString()}`}
              </p>
            </div>
            <div className="text-right">
              <p className="text-2xl font-bold text-foreground">{cs}{quote.total}</p>
              <p className="text-xs text-muted-foreground">Subtotal: {cs}{quote.subtotal} + Tax: {cs}{quote.tax_amount}</p>
            </div>
          </div>

          {/* Actions */}
          <div className="mt-4 pt-4 border-t border-border flex flex-wrap gap-3">
            {!editing && (
              <Button variant="outline" onClick={startEditing} className="border-primary text-primary hover:bg-primary/5 hover:text-primary">
                Edit Details
              </Button>
            )}
            <Button
              variant="outline"
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
            >
              Download PDF
            </Button>
            {quote.status === "draft" && (
              <>
                <Button onClick={() => handleTransition("sent")} disabled={saving}>
                  {saving ? "..." : "Mark as Sent"}
                </Button>
                <Button onClick={() => handleTransition("accepted")} disabled={saving} variant="success">
                  {saving ? "..." : "Accept & Create Event"}
                </Button>
              </>
            )}
            {quote.status === "sent" && (
              <>
                <Button onClick={() => handleTransition("accepted")} disabled={saving} variant="success">
                  {saving ? "..." : "Accept & Create Event"}
                </Button>
                <Button variant="outline" onClick={() => handleTransition("declined")} disabled={saving} className="border-destructive/50 text-destructive hover:bg-destructive/10">
                  {saving ? "..." : "Declined"}
                </Button>
                <Button variant="outline" onClick={() => handleTransition("draft")} disabled={saving}>
                  {saving ? "..." : "Back to Draft"}
                </Button>
              </>
            )}
            {(quote.status === "expired" || quote.status === "declined") && (
              <Button variant="outline" onClick={() => handleTransition("draft")} disabled={saving}>
                {saving ? "..." : "Reopen as Draft"}
              </Button>
            )}
          </div>

          {/* Event link when accepted */}
          {quote.status === "accepted" && quote.event_id && (
            <div className="mt-4 p-3 bg-success/10 border border-success/20 rounded flex items-center justify-between">
              <span className="text-success text-sm">Event created from this quote</span>
              <Link href={`/events/${quote.event_id}`} className="text-success font-medium text-sm hover:underline">
                View Event &rarr;
              </Link>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Edit Form (shown when editing) */}
      {editing && (
        <form onSubmit={handleSaveDetails} className="bg-muted border border-border rounded-lg p-6">
          <h2 className="text-lg font-semibold text-foreground mb-4">Edit Quote Details</h2>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-foreground mb-1">Contact Person</label>
              <select value={editData.primary_contact} onChange={setEdit("primary_contact")} className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring">
                <option value="">-- No contact --</option>
                {contacts.map((c) => <option key={c.id} value={c.id}>{c.name} ({c.role})</option>)}
              </select>
            </div>
            <div>
              <label className="block text-sm font-medium text-foreground mb-1">Event Date</label>
              <Input type="date" required value={editData.event_date} onChange={setEdit("event_date")} />
            </div>
            <div>
              <label className="block text-sm font-medium text-foreground mb-1">Guest Count</label>
              <Input type="number" required min={1} value={editData.guest_count} onChange={setEdit("guest_count")} />
            </div>
            <div>
              <label className="block text-sm font-medium text-foreground mb-1">Price Per Head ({cs})</label>
              <div className="flex gap-2">
                <Input type="number" step="0.01" min={0} value={editData.price_per_head} onChange={setEdit("price_per_head")} placeholder="0.00" />
                {suggestedPrice !== null && (
                  <Button
                    type="button"
                    variant="outline"
                    onClick={() => setEditData({ ...editData, price_per_head: suggestedPrice.toFixed(2) })}
                    className="whitespace-nowrap border-success/30 text-success bg-success/10 hover:bg-success/15 hover:text-success"
                  >
                    Use {cs}{suggestedPrice.toFixed(2)}
                  </Button>
                )}
              </div>
              {suggestedPrice !== null && (
                <p className="text-xs text-success/80 mt-1">
                  Suggested: {cs}{suggestedPrice.toFixed(2)}/head
                </p>
              )}
              {editData.price_per_head && editData.guest_count && (
                <p className="text-xs text-muted-foreground mt-1">
                  Food total: {cs}{(parseFloat(editData.price_per_head) * Number(editData.guest_count)).toFixed(2)}
                </p>
              )}
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
              <label className="block text-sm font-medium text-foreground mb-1">Service Style</label>
              <select value={editData.service_style} onChange={setEdit("service_style")} className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring">
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
              <label className="block text-sm font-medium text-foreground mb-1">Venue</label>
              <select value={editData.venue} onChange={setEdit("venue")} className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring">
                <option value="">-- No venue --</option>
                {venues.map((v) => <option key={v.id} value={v.id}>{v.name}</option>)}
              </select>
            </div>
            <div className="md:col-span-2">
              <label className="block text-sm font-medium text-foreground mb-1">Venue Address / Notes</label>
              <Textarea value={editData.venue_address} onChange={setEdit("venue_address")} rows={2} placeholder="Freeform address or additional venue notes" />
            </div>
            <div>
              <label className="block text-sm font-medium text-foreground mb-1">Tax Rate (%)</label>
              <Input type="number" step="0.01" min={0} max={100} value={editData.tax_rate} onChange={setEdit("tax_rate")} />
            </div>
            <div>
              <label className="block text-sm font-medium text-foreground mb-1">Valid Until</label>
              <Input type="date" value={editData.valid_until} onChange={setEdit("valid_until")} />
            </div>
            <div>
              <label className="block text-sm font-medium text-foreground mb-1">Notes (customer-visible)</label>
              <Textarea value={editData.notes} onChange={setEdit("notes")} rows={2} />
            </div>
            <div>
              <label className="block text-sm font-medium text-foreground mb-1">Internal Notes</label>
              <Textarea value={editData.internal_notes} onChange={setEdit("internal_notes")} rows={2} />
            </div>
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
      )}

      {/* Customer & Venue (always visible) */}
      {!editing && (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          <Card>
            <CardContent className="p-6">
              <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide mb-3">Customer</h2>
              <div className="space-y-2 text-sm">
                <div>
                  <span className="text-muted-foreground">Account:</span>{" "}
                  <Link href={`/accounts/${quote.account}`} className="text-primary hover:underline font-medium">{quote.account_name}</Link>
                </div>
                {quote.contact_name ? (
                  <div>
                    <span className="text-muted-foreground">Contact:</span> {quote.contact_name}
                    {quote.contact_email && (
                      <span className="text-muted-foreground ml-2">{quote.contact_email}</span>
                    )}
                    {quote.contact_phone && (
                      <span className="text-muted-foreground ml-2">{quote.contact_phone}</span>
                    )}
                  </div>
                ) : (
                  <div className="text-muted-foreground italic">No contact person set</div>
                )}
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardContent className="p-6">
              <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide mb-3">Venue</h2>
              <div className="space-y-2 text-sm">
                {quote.venue_name ? (
                  <div><span className="text-muted-foreground">Venue:</span> <span className="font-medium">{quote.venue_name}</span></div>
                ) : !quote.venue_address ? (
                  <div className="text-muted-foreground italic">No venue set</div>
                ) : null}
                {quote.venue_address && (
                  <div><span className="text-muted-foreground">Address:</span> {quote.venue_address}</div>
                )}
              </div>
            </CardContent>
          </Card>
        </div>
      )}

      {/* Event Details (always visible) */}
      {!editing && (
        <Card>
          <CardContent className="p-6">
            <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide mb-3">Event Details</h2>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-sm">
              <div>
                <span className="text-muted-foreground block">Date</span>
                <span className="font-medium text-foreground">{quote.event_date}</span>
              </div>
              <div>
                <span className="text-muted-foreground block">Guests</span>
                <span className="font-medium text-foreground">{quote.guest_count}</span>
              </div>
              <div>
                <span className="text-muted-foreground block">Event Type</span>
                <span className="font-medium text-foreground capitalize">{quote.event_type.replace(/_/g, " ")}</span>
              </div>
              <div>
                <span className="text-muted-foreground block">Service Style</span>
                <span className="font-medium text-foreground capitalize">{quote.service_style ? quote.service_style.replace(/_/g, " ") : "—"}</span>
              </div>
              <div>
                <span className="text-muted-foreground block">Price Per Head</span>
                <span className="font-medium text-foreground">{quote.price_per_head ? `${cs}${quote.price_per_head}` : "—"}</span>
              </div>
              <div>
                <span className="text-muted-foreground block">Tax Rate</span>
                <span className="font-medium text-foreground">{(parseFloat(quote.tax_rate) * 100).toFixed(0)}%</span>
              </div>
              <div>
                <span className="text-muted-foreground block">Valid Until</span>
                <span className="font-medium text-foreground">{quote.valid_until || "—"}</span>
              </div>
            </div>
            {(quote.notes || quote.internal_notes) && (
              <div className="mt-4 pt-4 border-t border-border grid grid-cols-1 md:grid-cols-2 gap-4 text-sm">
                {quote.notes && (
                  <div>
                    <span className="text-muted-foreground block mb-1">Notes (customer-visible)</span>
                    <p className="text-foreground">{quote.notes}</p>
                  </div>
                )}
                {quote.internal_notes && (
                  <div>
                    <span className="text-muted-foreground block mb-1">Internal Notes</span>
                    <p className="text-foreground/70 italic">{quote.internal_notes}</p>
                  </div>
                )}
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {/* Menu */}
      <Card>
        <CardContent className="p-6">
          <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide mb-3">Menu</h2>
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
        </CardContent>
      </Card>

      {/* Line Items */}
      <Card>
        <CardContent className="p-6">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide">Line Items</h2>
            <Button size="sm" onClick={() => setShowItemForm(!showItemForm)}>
              {showItemForm ? "Cancel" : "Add Item"}
            </Button>
          </div>

          {showItemForm && (
            <form onSubmit={handleAddItem} className="border border-border rounded p-4 mb-4">
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                <div>
                  <label className="block text-sm font-medium text-foreground mb-1">Category</label>
                  <select value={itemData.category} onChange={(e) => setItemData({ ...itemData, category: e.target.value })} className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring">
                    <option value="food">Food</option>
                    <option value="beverage">Beverage</option>
                    <option value="rental">Rental</option>
                    <option value="labor">Labour</option>
                    <option value="fee">Fee</option>
                    <option value="discount">Discount</option>
                  </select>
                </div>
                <div className="md:col-span-2">
                  <label className="block text-sm font-medium text-foreground mb-1">Description</label>
                  <Input type="text" required value={itemData.description} onChange={(e) => setItemData({ ...itemData, description: e.target.value })} />
                </div>
                <div>
                  <label className="block text-sm font-medium text-foreground mb-1">Quantity</label>
                  <Input type="number" step="0.01" min={0} required value={itemData.quantity} onChange={(e) => setItemData({ ...itemData, quantity: e.target.value })} />
                </div>
                <div>
                  <label className="block text-sm font-medium text-foreground mb-1">Unit</label>
                  <select value={itemData.unit} onChange={(e) => setItemData({ ...itemData, unit: e.target.value })} className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring">
                    <option value="each">Each</option>
                    <option value="per_guest">Per Guest</option>
                    <option value="per_hour">Per Hour</option>
                    <option value="flat">Flat Rate</option>
                  </select>
                </div>
                <div>
                  <label className="block text-sm font-medium text-foreground mb-1">Unit Price ({cs})</label>
                  <Input type="number" step="0.01" min={0} required value={itemData.unit_price} onChange={(e) => setItemData({ ...itemData, unit_price: e.target.value })} />
                </div>
                <div className="flex items-center gap-2 mt-6">
                  <input type="checkbox" checked={itemData.is_taxable} onChange={(e) => setItemData({ ...itemData, is_taxable: e.target.checked })} className="rounded border-input" />
                  <label className="text-sm text-foreground">Taxable</label>
                </div>
              </div>
              <Button type="submit" disabled={saving} variant="success" className="mt-4">
                {saving ? "Adding..." : "Add Item"}
              </Button>
            </form>
          )}

          {quote.line_items.length === 0 && parseFloat(quote.food_total) === 0 ? (
            <p className="text-muted-foreground text-sm">No line items yet. Click &quot;Add Item&quot; to start building this quote.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-border text-left text-muted-foreground">
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
                    <tr key={item.id} className="border-b border-border/50">
                      <td className="py-2">
                        <Badge variant="secondary" className="text-xs">
                          {CATEGORY_LABELS[item.category] || item.category}
                        </Badge>
                      </td>
                      <td className="py-2 text-foreground">{item.description}</td>
                      <td className="py-2 text-right text-foreground/80">{item.quantity}</td>
                      <td className="py-2 text-muted-foreground">{item.unit.replace(/_/g, " ")}</td>
                      <td className="py-2 text-right text-foreground/80">{cs}{item.unit_price}</td>
                      <td className="py-2 text-right font-medium text-foreground">{cs}{item.line_total}</td>
                      <td className="py-2 text-right">
                        <Button variant="ghost" size="sm" onClick={() => handleDeleteItem(item.id)} className="text-destructive hover:text-destructive h-auto py-0.5 px-1.5 text-xs">
                          Remove
                        </Button>
                      </td>
                    </tr>
                  ))}
                </tbody>
                <tfoot>
                  {parseFloat(quote.food_total) > 0 && (
                    <tr className="border-t border-border">
                      <td colSpan={5} className="pt-3 text-right text-muted-foreground">
                        Food ({cs}{quote.price_per_head} x {quote.guest_count} guests)
                      </td>
                      <td className="pt-3 text-right font-medium">{cs}{quote.food_total}</td>
                      <td></td>
                    </tr>
                  )}
                  <tr className={parseFloat(quote.food_total) > 0 ? "" : "border-t border-border"}>
                    <td colSpan={5} className="pt-3 text-right text-muted-foreground">Subtotal</td>
                    <td className="pt-3 text-right font-medium">{cs}{quote.subtotal}</td>
                    <td></td>
                  </tr>
                  <tr>
                    <td colSpan={5} className="py-1 text-right text-muted-foreground">VAT ({(parseFloat(quote.tax_rate) * 100).toFixed(0)}%)</td>
                    <td className="py-1 text-right">{cs}{quote.tax_amount}</td>
                    <td></td>
                  </tr>
                  <tr className="border-t border-border">
                    <td colSpan={5} className="pt-2 text-right font-semibold text-foreground">Total</td>
                    <td className="pt-2 text-right font-bold text-lg text-foreground">{cs}{quote.total}</td>
                    <td></td>
                  </tr>
                </tfoot>
              </table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
