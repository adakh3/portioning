"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { useParams, useRouter } from "next/navigation";
import Link from "next/link";
import { api, Contact } from "@/lib/api";
import { useQuote, useAccounts, useVenues, useSiteSettings, useDateFormat, useEventTypes, useServiceStyles, useMealTypes, useLeads, revalidate } from "@/lib/hooks";
import { formatDate } from "@/lib/dateFormat";
import { formatCurrency } from "@/lib/utils";
import MenuBuilder from "@/components/MenuBuilder";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { ValidatedInput } from "@/components/ui/validated-input";
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
  const router = useRouter();
  const isNew = id === "new";
  const { data: quote, error: loadError, isLoading: quoteLoading, mutate: mutateQuote } = useQuote(isNew ? null : (Number(id) || null));
  const loading = isNew ? false : quoteLoading;
  const { data: accounts = [] } = useAccounts();
  const { data: venues = [] } = useVenues();
  const { data: rawSettings } = useSiteSettings();
  const settings = rawSettings || { currency_symbol: "£", currency_code: "GBP", date_format: "DD/MM/YYYY", default_price_per_head: "0.00", target_food_cost_percentage: "30.00", price_rounding_step: "50" };
  const dateFormat = useDateFormat();
  const { data: eventTypes = [] } = useEventTypes();
  const { data: serviceStyles = [] } = useServiceStyles();
  const { data: mealTypes = [] } = useMealTypes();
  const { data: allLeads = [] } = useLeads();
  const leads = allLeads.filter((l) => !["won", "lost"].includes(l.status));
  const [showItemForm, setShowItemForm] = useState(false);
  const [saving, setSaving] = useState(false);
  const [editing, setEditing] = useState(false);
  const [contacts, setContacts] = useState<Contact[]>([]);
  const [error, setError] = useState("");
  const [editData, setEditData] = useState({
    primary_contact: "",
    event_date: "",
    guest_count: "",
    price_per_head: "",
    venue: "",
    venue_address: "",
    event_type: "",
    meal_type: "",
    booking_date: "",
    service_style: "",
    tax_rate: "",
    valid_until: "",
    notes: "",
    internal_notes: "",
  });
  const [showAcceptConfirm, setShowAcceptConfirm] = useState(false);
  const [suggestedPrice, setSuggestedPrice] = useState<number | null>(null);
  const handleSuggestedPriceChange = useCallback((price: number | null) => setSuggestedPrice(price), []);

  // Create mode state
  const [createData, setCreateData] = useState({
    lead: "",
    account: "",
    primary_contact: "",
    venue: "",
    venue_address: "",
    event_date: "",
    guest_count: "",
    price_per_head: "",
    event_type: "other",
    meal_type: "",
    booking_date: "",
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
  const [createContacts, setCreateContacts] = useState<Contact[]>([]);

  // Set default price from settings in create mode
  const defaultPriceApplied = useRef(false);
  useEffect(() => {
    if (isNew && rawSettings && parseFloat(rawSettings.default_price_per_head) > 0 && !defaultPriceApplied.current) {
      setCreateData((prev) => ({ ...prev, price_per_head: rawSettings.default_price_per_head }));
      defaultPriceApplied.current = true;
    }
  }, [isNew, rawSettings]);

  // Load contacts when account changes in create mode
  useEffect(() => {
    if (!isNew) return;
    if (createData.account) {
      const acct = accounts.find((a) => a.id === Number(createData.account));
      setCreateContacts(acct?.contacts || []);
      setCreateData((prev) => ({ ...prev, primary_contact: "" }));
    } else {
      setCreateContacts([]);
    }
  }, [isNew, createData.account, accounts]);

  const setCreate = (field: string) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) =>
    setCreateData({ ...createData, [field]: e.target.value });

  function handleLeadSelect(e: React.ChangeEvent<HTMLSelectElement>) {
    const leadId = e.target.value;
    if (!leadId) {
      setCreateData((prev) => ({ ...prev, lead: "" }));
      return;
    }
    const selectedLead = leads.find((l) => l.id === Number(leadId));
    if (!selectedLead) return;
    setCreateData((prev) => ({
      ...prev,
      lead: leadId,
      account: selectedLead.account ? String(selectedLead.account) : prev.account,
      event_date: selectedLead.event_date || prev.event_date,
      guest_count: selectedLead.guest_estimate ? String(selectedLead.guest_estimate) : prev.guest_count,
      event_type: selectedLead.event_type || prev.event_type,
      meal_type: selectedLead.meal_type || prev.meal_type,
      service_style: selectedLead.service_style || prev.service_style,
    }));
  }

  async function handleCreateQuoteSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    setError("");
    try {
      const data = {
        lead: createData.lead ? Number(createData.lead) : null,
        account: Number(createData.account),
        primary_contact: createData.primary_contact ? Number(createData.primary_contact) : null,
        venue: createData.venue ? Number(createData.venue) : null,
        venue_address: createData.venue_address,
        event_date: createData.event_date,
        guest_count: Number(createData.guest_count),
        price_per_head: createData.price_per_head ? createData.price_per_head : null,
        event_type: createData.event_type,
        meal_type: createData.meal_type || undefined,
        booking_date: createData.booking_date || null,
        service_style: createData.service_style || undefined,
        tax_rate: createData.tax_rate,
        valid_until: createData.valid_until || null,
        notes: createData.notes,
        internal_notes: createData.internal_notes,
        dish_ids: menuData.dish_ids,
        based_on_template: menuData.based_on_template,
      };
      const newQuote = await api.createQuote(data);
      revalidate("quotes");
      router.push(`/quotes/${newQuote.id}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to create quote");
      setSaving(false);
    }
  }
  const [itemData, setItemData] = useState({
    category: "food",
    description: "",
    quantity: "1",
    unit: "each",
    unit_price: "",
    is_taxable: true,
    sort_order: 0,
  });

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
      meal_type: quote.meal_type || "",
      booking_date: quote.booking_date || "",
      service_style: quote.service_style || "",
      tax_rate: String(Math.round(parseFloat(quote.tax_rate) * 10000) / 100),
      valid_until: quote.valid_until || "",
      notes: quote.notes,
      internal_notes: quote.internal_notes,
    });
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
      await api.updateQuote(quote.id, {
        primary_contact: editData.primary_contact ? Number(editData.primary_contact) : null,
        event_date: editData.event_date,
        guest_count: Number(editData.guest_count),
        price_per_head: editData.price_per_head ? editData.price_per_head : null,
        venue: editData.venue ? Number(editData.venue) : null,
        venue_address: editData.venue_address,
        event_type: editData.event_type,
        meal_type: editData.meal_type || undefined,
        booking_date: editData.booking_date || null,
        service_style: editData.service_style || undefined,
        tax_rate: (parseFloat(editData.tax_rate) / 100).toFixed(4),
        valid_until: editData.valid_until || null,
        notes: editData.notes,
        internal_notes: editData.internal_notes,
      });
      await mutateQuote();
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
      await mutateQuote();
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
      await mutateQuote();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to delete item");
    }
  }

  async function handleTransition(newStatus: string) {
    if (!quote) return;
    setSaving(true);
    setError("");
    try {
      await api.transitionQuote(quote.id, newStatus);
      await mutateQuote();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to update status");
    } finally {
      setSaving(false);
    }
  }

  if (loading) return <p className="text-muted-foreground">Loading...</p>;
  if (!isNew && loadError && !quote) return <p className="text-destructive">Error: {loadError.message}</p>;
  if (!isNew && !quote) return <p className="text-muted-foreground">Quote not found.</p>;

  const cs = settings.currency_symbol;

  const setEdit = (field: string) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) =>
    setEditData({ ...editData, [field]: e.target.value });

  const selectClass = "flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring";
  const venueSelected = !!createData.venue;

  // Create mode
  if (isNew) {
    return (
      <div className="space-y-6">
        <div className="flex items-center gap-2 text-sm">
          <Link href="/quotes" className="text-primary hover:underline">&larr; Quotes</Link>
        </div>

        {error && <p className="text-destructive">{error}</p>}

        <form onSubmit={handleCreateQuoteSubmit} className="space-y-6">
          {/* Header */}
          <Card>
            <CardContent className="p-6">
              <h1 className="text-2xl font-bold text-foreground">New Quote</h1>
            </CardContent>
          </Card>

          {/* Customer */}
          <Card>
            <CardContent className="p-6">
              <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide mb-3">Customer</h2>
              <div className="mb-4">
                <label className="block text-sm font-medium text-foreground mb-1">Link to Lead</label>
                <select value={createData.lead} onChange={handleLeadSelect} className={selectClass}>
                  <option value="">-- No lead (standalone quote) --</option>
                  {leads.map((l) => (
                    <option key={l.id} value={l.id}>
                      {l.contact_name}{l.event_type_display ? ` — ${l.event_type_display}` : ""}{l.event_date ? ` (${l.event_date})` : ""}
                    </option>
                  ))}
                </select>
              </div>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-foreground mb-1">Account *</label>
                  <select required value={createData.account} onChange={setCreate("account")} className={selectClass}>
                    <option value="">-- Select Account --</option>
                    {accounts.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
                  </select>
                </div>
                <div>
                  <label className="block text-sm font-medium text-foreground mb-1">Contact Person</label>
                  <select value={createData.primary_contact} onChange={setCreate("primary_contact")} disabled={!createData.account} className={`${selectClass} disabled:cursor-not-allowed disabled:opacity-50`}>
                    <option value="">-- Select Contact --</option>
                    {createContacts.map((c) => <option key={c.id} value={c.id}>{c.name} ({c.role})</option>)}
                  </select>
                  {createData.account && createContacts.length === 0 && (
                    <p className="text-xs text-muted-foreground mt-1">No contacts on this account</p>
                  )}
                </div>
              </div>
            </CardContent>
          </Card>

          {/* Event Details */}
          <Card>
            <CardContent className="p-6">
              <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide mb-3">Event Details</h2>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-foreground mb-1">Event Date *</label>
                  <ValidatedInput type="date" required value={createData.event_date} onChange={setCreate("event_date")} />
                </div>
                <div>
                  <label className="block text-sm font-medium text-foreground mb-1">Guest Count *</label>
                  <ValidatedInput type="number" required min={1} max={50000} value={createData.guest_count} onChange={setCreate("guest_count")} />
                </div>
                <div>
                  <label className="block text-sm font-medium text-foreground mb-1">Event Type</label>
                  <select value={createData.event_type} onChange={setCreate("event_type")} className={selectClass}>
                    {eventTypes.map((et) => <option key={et.id} value={et.value}>{et.label}</option>)}
                  </select>
                </div>
                <div>
                  <label className="block text-sm font-medium text-foreground mb-1">Meal Type</label>
                  <select value={createData.meal_type} onChange={setCreate("meal_type")} className={selectClass}>
                    <option value="">-- Select --</option>
                    {mealTypes.map((mt) => <option key={mt.id} value={mt.value}>{mt.label}</option>)}
                  </select>
                </div>
                <div>
                  <label className="block text-sm font-medium text-foreground mb-1">Booking Date</label>
                  <ValidatedInput type="date" value={createData.booking_date} onChange={setCreate("booking_date")} />
                </div>
                <div>
                  <label className="block text-sm font-medium text-foreground mb-1">Service Style</label>
                  <select value={createData.service_style} onChange={setCreate("service_style")} className={selectClass}>
                    <option value="">-- Select --</option>
                    {serviceStyles.map((ss) => <option key={ss.id} value={ss.value}>{ss.label}</option>)}
                  </select>
                </div>
              </div>
            </CardContent>
          </Card>

          {/* Venue */}
          <Card>
            <CardContent className="p-6">
              <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide mb-3">Venue</h2>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-foreground mb-1">Saved Venue</label>
                  <select value={createData.venue} onChange={setCreate("venue")} className={selectClass}>
                    <option value="">-- No saved venue --</option>
                    {venues.map((v) => <option key={v.id} value={v.id}>{v.name} — {v.city}</option>)}
                  </select>
                </div>
                <div>
                  <label className="block text-sm font-medium text-foreground mb-1">
                    {venueSelected ? "Additional Address Notes" : "Venue Address (freeform)"}
                  </label>
                  <Textarea
                    value={createData.venue_address}
                    onChange={setCreate("venue_address")}
                    rows={2}
                    maxLength={300}
                    placeholder={venueSelected ? "e.g. Use the garden entrance" : "e.g. 42 Oak Lane, Manchester, M1 2AB"}
                  />
                </div>
              </div>
            </CardContent>
          </Card>

          {/* Menu */}
          <Card>
            <CardContent className="p-6">
              <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide mb-3">Menu</h2>
              <MenuBuilder
                selectedDishIds={menuData.dish_ids}
                basedOnTemplate={menuData.based_on_template}
                guestCount={createData.guest_count ? Number(createData.guest_count) : undefined}
                onChange={setMenuData}
                onSuggestedPriceChange={handleSuggestedPriceChange}
                onUseSuggestedPrice={(price) => setCreateData((prev) => ({ ...prev, price_per_head: price.toFixed(2) }))}
                currencySymbol={cs}
                priceRoundingStep={Number(settings.price_rounding_step) || 50}
              />
            </CardContent>
          </Card>

          {/* Pricing & Terms */}
          <Card>
            <CardContent className="p-6">
              <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide mb-3">Pricing &amp; Terms</h2>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-foreground mb-1">Price Per Head ({cs})</label>
                  <div className="flex gap-2">
                    <ValidatedInput
                      type="number"
                      step="0.01"
                      min={0}
                      max={9999999.99}
                      value={createData.price_per_head}
                      onChange={setCreate("price_per_head")}
                      placeholder="0.00"
                    />
                    {suggestedPrice !== null && (
                      <Button
                        type="button"
                        variant="outline"
                        onClick={() => setCreateData({ ...createData, price_per_head: suggestedPrice.toFixed(2) })}
                        className="whitespace-nowrap border-success/30 text-success bg-success/10 hover:bg-success/15 hover:text-success"
                      >
                        Use {formatCurrency(suggestedPrice, cs)}
                      </Button>
                    )}
                  </div>
                  {suggestedPrice !== null && (
                    <p className="text-xs text-success/80 mt-1">
                      Suggested: {formatCurrency(suggestedPrice, cs)}/head
                    </p>
                  )}
                  {createData.price_per_head && createData.guest_count && (
                    <p className="text-xs text-muted-foreground mt-1">
                      Food total: {formatCurrency(parseFloat(createData.price_per_head) * Number(createData.guest_count), cs)} ({createData.guest_count} guests)
                    </p>
                  )}
                </div>
                <div>
                  <label className="block text-sm font-medium text-foreground mb-1">Tax Rate (%)</label>
                  <ValidatedInput
                    type="number"
                    step="0.01"
                    min={0}
                    max={100}
                    value={Math.round(parseFloat(createData.tax_rate) * 10000) / 100}
                    onChange={(e) => setCreateData({ ...createData, tax_rate: (parseFloat(e.target.value) / 100).toFixed(4) })}
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-foreground mb-1">Valid Until</label>
                  <ValidatedInput type="date" value={createData.valid_until} onChange={setCreate("valid_until")} />
                </div>
              </div>
            </CardContent>
          </Card>

          {/* Notes */}
          <Card>
            <CardContent className="p-6">
              <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide mb-3">Notes</h2>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-foreground mb-1">Notes (customer-visible)</label>
                  <Textarea value={createData.notes} onChange={setCreate("notes")} rows={3} maxLength={2000} />
                </div>
                <div>
                  <label className="block text-sm font-medium text-foreground mb-1">Internal Notes</label>
                  <Textarea value={createData.internal_notes} onChange={setCreate("internal_notes")} rows={3} maxLength={2000} />
                </div>
              </div>
            </CardContent>
          </Card>

          {/* Bottom action bar */}
          <div className="sticky bottom-4 flex justify-end gap-3 z-10">
            <Button type="button" variant="outline" onClick={() => router.push("/quotes")}>
              Discard
            </Button>
            <Button type="submit" disabled={saving}>
              {saving ? "Creating..." : "Create Quote"}
            </Button>
          </div>
        </form>
      </div>
    );
  }

  // At this point, quote is guaranteed to be defined
  const q = quote!;

  return (
    <div className="space-y-6">
      {/* Breadcrumb */}
      <div className="flex items-center gap-2 text-sm">
        <Link href="/quotes" className="text-primary hover:underline">&larr; Quotes</Link>
        {q.lead && q.lead_name && (
          <>
            <span className="text-muted-foreground">&middot;</span>
            <span className="text-muted-foreground">From Lead:</span>
            <Link href={`/leads/${q.lead}`} className="text-primary hover:underline">{q.lead_name}</Link>
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
                <h1 className="text-2xl font-bold text-foreground">Quote #{q.id} v{q.version}</h1>
                <Badge variant={STATUS_BADGE_VARIANT[q.status] || "secondary"}>
                  {q.status_display}
                </Badge>
              </div>
              <p className="text-sm text-muted-foreground mt-1">
                Created {formatDate(q.created_at, dateFormat)}
                {q.sent_at && ` · Sent ${formatDate(q.sent_at, dateFormat)}`}
                {q.accepted_at && ` · Accepted ${formatDate(q.accepted_at, dateFormat)}`}
              </p>
            </div>
            <div className="text-right">
              <p className="text-2xl font-bold text-foreground">{formatCurrency(q.total, cs)}</p>
              <p className="text-xs text-muted-foreground">Subtotal: {formatCurrency(q.subtotal, cs)} + Tax: {formatCurrency(q.tax_amount, cs)}</p>
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
                  const blob = await api.downloadQuotePDF(q.id);
                  const url = URL.createObjectURL(blob);
                  const a = document.createElement("a");
                  a.href = url;
                  a.download = `Quote-${q.id}-v${q.version}.pdf`;
                  a.click();
                  URL.revokeObjectURL(url);
                } catch (err) {
                  setError(err instanceof Error ? err.message : "Failed to download PDF");
                }
              }}
            >
              Download PDF
            </Button>
            {q.status === "draft" && (
              <>
                <Button onClick={() => handleTransition("sent")} disabled={saving}>
                  {saving ? "..." : "Mark as Sent"}
                </Button>
                <Button onClick={() => setShowAcceptConfirm(true)} disabled={saving} variant="success">
                  {saving ? "..." : "Accept & Create Event"}
                </Button>
              </>
            )}
            {q.status === "sent" && (
              <>
                <Button onClick={() => setShowAcceptConfirm(true)} disabled={saving} variant="success">
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
            {(q.status === "expired" || q.status === "declined") && (
              <Button variant="outline" onClick={() => handleTransition("draft")} disabled={saving}>
                {saving ? "..." : "Reopen as Draft"}
              </Button>
            )}
          </div>

          {/* Event link when accepted */}
          {q.status === "accepted" && q.event_id && (
            <div className="mt-4 p-3 bg-success/10 border border-success/20 rounded flex items-center justify-between">
              <span className="text-success text-sm">Event created from this quote</span>
              <Link href={`/events/${q.event_id}`} className="text-success font-medium text-sm hover:underline">
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
              <label className="block text-sm font-medium text-foreground mb-1">Event Date *</label>
              <ValidatedInput type="date" required value={editData.event_date} onChange={setEdit("event_date")} />
            </div>
            <div>
              <label className="block text-sm font-medium text-foreground mb-1">Guest Count *</label>
              <ValidatedInput type="number" required min={1} max={50000} value={editData.guest_count} onChange={setEdit("guest_count")} />
            </div>
            <div>
              <label className="block text-sm font-medium text-foreground mb-1">Price Per Head ({cs})</label>
              <div className="flex gap-2">
                <ValidatedInput type="number" step="0.01" min={0} max={9999999.99} value={editData.price_per_head} onChange={setEdit("price_per_head")} placeholder="0.00" />
                {suggestedPrice !== null && (
                  <Button
                    type="button"
                    variant="outline"
                    onClick={() => setEditData({ ...editData, price_per_head: suggestedPrice.toFixed(2) })}
                    className="whitespace-nowrap border-success/30 text-success bg-success/10 hover:bg-success/15 hover:text-success"
                  >
                    Use {formatCurrency(suggestedPrice, cs)}
                  </Button>
                )}
              </div>
              {suggestedPrice !== null && (
                <p className="text-xs text-success/80 mt-1">
                  Suggested: {formatCurrency(suggestedPrice, cs)}/head
                </p>
              )}
              {editData.price_per_head && editData.guest_count && (
                <p className="text-xs text-muted-foreground mt-1">
                  Food total: {formatCurrency(parseFloat(editData.price_per_head) * Number(editData.guest_count), cs)}
                </p>
              )}
            </div>
            <div>
              <label className="block text-sm font-medium text-foreground mb-1">Event Type</label>
              <select value={editData.event_type} onChange={setEdit("event_type")} className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring">
                {eventTypes.map((et) => <option key={et.id} value={et.value}>{et.label}</option>)}
              </select>
            </div>
            <div>
              <label className="block text-sm font-medium text-foreground mb-1">Meal Type</label>
              <select value={editData.meal_type} onChange={setEdit("meal_type")} className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring">
                <option value="">-- None --</option>
                {mealTypes.map((mt) => <option key={mt.id} value={mt.value}>{mt.label}</option>)}
              </select>
            </div>
            <div>
              <label className="block text-sm font-medium text-foreground mb-1">Booking Date</label>
              <ValidatedInput type="date" value={editData.booking_date} onChange={setEdit("booking_date")} />
            </div>
            <div>
              <label className="block text-sm font-medium text-foreground mb-1">Service Style</label>
              <select value={editData.service_style} onChange={setEdit("service_style")} className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring">
                <option value="">-- None --</option>
                {serviceStyles.map((ss) => <option key={ss.id} value={ss.value}>{ss.label}</option>)}
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
              <Textarea value={editData.venue_address} onChange={setEdit("venue_address")} rows={2} maxLength={300} placeholder="Freeform address or additional venue notes" />
            </div>
            <div>
              <label className="block text-sm font-medium text-foreground mb-1">Tax Rate (%)</label>
              <ValidatedInput type="number" step="0.01" min={0} max={100} value={editData.tax_rate} onChange={setEdit("tax_rate")} />
            </div>
            <div>
              <label className="block text-sm font-medium text-foreground mb-1">Valid Until</label>
              <ValidatedInput type="date" value={editData.valid_until} onChange={setEdit("valid_until")} />
            </div>
            <div>
              <label className="block text-sm font-medium text-foreground mb-1">Notes (customer-visible)</label>
              <Textarea value={editData.notes} onChange={setEdit("notes")} rows={2} maxLength={2000} />
            </div>
            <div>
              <label className="block text-sm font-medium text-foreground mb-1">Internal Notes</label>
              <Textarea value={editData.internal_notes} onChange={setEdit("internal_notes")} rows={2} maxLength={2000} />
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
                  <Link href={`/accounts/${q.account}`} className="text-primary hover:underline font-medium">{q.account_name}</Link>
                </div>
                {q.contact_name ? (
                  <div>
                    <span className="text-muted-foreground">Contact:</span> {q.contact_name}
                    {q.contact_email && (
                      <span className="text-muted-foreground ml-2">{q.contact_email}</span>
                    )}
                    {q.contact_phone && (
                      <span className="text-muted-foreground ml-2">{q.contact_phone}</span>
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
                {q.venue_name ? (
                  <div><span className="text-muted-foreground">Venue:</span> <span className="font-medium">{q.venue_name}</span></div>
                ) : !q.venue_address ? (
                  <div className="text-muted-foreground italic">No venue set</div>
                ) : null}
                {q.venue_address && (
                  <div><span className="text-muted-foreground">Address:</span> {q.venue_address}</div>
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
                <span className="font-medium text-foreground">{q.event_date}</span>
              </div>
              <div>
                <span className="text-muted-foreground block">Guests</span>
                <span className="font-medium text-foreground">{q.guest_count}</span>
              </div>
              <div>
                <span className="text-muted-foreground block">Event Type</span>
                <span className="font-medium text-foreground capitalize">{q.event_type.replace(/_/g, " ")}</span>
              </div>
              <div>
                <span className="text-muted-foreground block">Meal Type</span>
                <span className="font-medium text-foreground capitalize">{q.meal_type ? q.meal_type.replace(/_/g, " ") : "—"}</span>
              </div>
              <div>
                <span className="text-muted-foreground block">Booking Date</span>
                <span className="font-medium text-foreground">{q.booking_date ? formatDate(q.booking_date, dateFormat) : "—"}</span>
              </div>
              <div>
                <span className="text-muted-foreground block">Service Style</span>
                <span className="font-medium text-foreground capitalize">{q.service_style ? q.service_style.replace(/_/g, " ") : "—"}</span>
              </div>
              <div>
                <span className="text-muted-foreground block">Price Per Head</span>
                <span className="font-medium text-foreground">{q.price_per_head ? formatCurrency(q.price_per_head, cs) : "—"}</span>
              </div>
              <div>
                <span className="text-muted-foreground block">Tax Rate</span>
                <span className="font-medium text-foreground">{(parseFloat(q.tax_rate) * 100).toFixed(0)}%</span>
              </div>
              <div>
                <span className="text-muted-foreground block">Valid Until</span>
                <span className="font-medium text-foreground">{q.valid_until || "—"}</span>
              </div>
            </div>
            {(q.notes || q.internal_notes) && (
              <div className="mt-4 pt-4 border-t border-border grid grid-cols-1 md:grid-cols-2 gap-4 text-sm">
                {q.notes && (
                  <div>
                    <span className="text-muted-foreground block mb-1">Notes (customer-visible)</span>
                    <p className="text-foreground">{q.notes}</p>
                  </div>
                )}
                {q.internal_notes && (
                  <div>
                    <span className="text-muted-foreground block mb-1">Internal Notes</span>
                    <p className="text-foreground/70 italic">{q.internal_notes}</p>
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
            selectedDishIds={q.dishes || []}
            basedOnTemplate={q.based_on_template || null}
            guestCount={editing && editData.guest_count ? Number(editData.guest_count) : q.guest_count}
            onSave={async (data) => {
              await api.updateQuote(q.id, {
                dish_ids: data.dish_ids,
                based_on_template: data.based_on_template,
              });
              await mutateQuote();
            }}
            onSuggestedPriceChange={handleSuggestedPriceChange}
            onUseSuggestedPrice={(price) => setEditData((prev) => ({ ...prev, price_per_head: price.toFixed(2) }))}
            currencySymbol={cs}
            priceRoundingStep={Number(settings.price_rounding_step) || 50}
          />
        </CardContent>
      </Card>

      {/* Accept Confirmation Dialog */}
      {showAcceptConfirm && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
          <div className="bg-background rounded-lg shadow-lg p-6 w-full max-w-md mx-4">
            <h3 className="text-lg font-semibold text-foreground mb-4">Accept Quote</h3>
            <p className="text-sm text-muted-foreground mb-4">
              Accepting this quote will create an event{q.lead ? " and mark the lead as Won" : ""}. Continue?
            </p>
            <div className="flex justify-end gap-2">
              <Button variant="secondary" onClick={() => setShowAcceptConfirm(false)}>
                Cancel
              </Button>
              <Button
                variant="success"
                disabled={saving}
                onClick={async () => {
                  setShowAcceptConfirm(false);
                  await handleTransition("accepted");
                }}
              >
                {saving ? "..." : "Accept"}
              </Button>
            </div>
          </div>
        </div>
      )}

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
                  <label className="block text-sm font-medium text-foreground mb-1">Description *</label>
                  <ValidatedInput type="text" required maxLength={100} value={itemData.description} onChange={(e) => setItemData({ ...itemData, description: e.target.value })} />
                </div>
                <div>
                  <label className="block text-sm font-medium text-foreground mb-1">Quantity *</label>
                  <ValidatedInput type="number" step="0.01" min={0} max={99999} required value={itemData.quantity} onChange={(e) => setItemData({ ...itemData, quantity: e.target.value })} />
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
                  <label className="block text-sm font-medium text-foreground mb-1">Unit Price ({cs}) *</label>
                  <ValidatedInput type="number" step="0.01" min={0} max={9999999.99} required value={itemData.unit_price} onChange={(e) => setItemData({ ...itemData, unit_price: e.target.value })} />
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

          {q.line_items.length === 0 && parseFloat(q.food_total) === 0 ? (
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
                  {q.line_items.map((item) => (
                    <tr key={item.id} className="border-b border-border/50">
                      <td className="py-2">
                        <Badge variant="secondary" className="text-xs">
                          {CATEGORY_LABELS[item.category] || item.category}
                        </Badge>
                      </td>
                      <td className="py-2 text-foreground">{item.description}</td>
                      <td className="py-2 text-right text-foreground/80">{item.quantity}</td>
                      <td className="py-2 text-muted-foreground">{item.unit.replace(/_/g, " ")}</td>
                      <td className="py-2 text-right text-foreground/80">{formatCurrency(item.unit_price, cs)}</td>
                      <td className="py-2 text-right font-medium text-foreground">{formatCurrency(item.line_total, cs)}</td>
                      <td className="py-2 text-right">
                        <Button variant="ghost" size="sm" onClick={() => handleDeleteItem(item.id)} className="text-destructive hover:text-destructive h-auto py-0.5 px-1.5 text-xs">
                          Remove
                        </Button>
                      </td>
                    </tr>
                  ))}
                </tbody>
                <tfoot>
                  {parseFloat(q.food_total) > 0 && (
                    <tr className="border-t border-border">
                      <td colSpan={5} className="pt-3 text-right text-muted-foreground">
                        Food ({formatCurrency(q.price_per_head ?? 0, cs)} x {q.guest_count} guests)
                      </td>
                      <td className="pt-3 text-right font-medium">{formatCurrency(q.food_total, cs)}</td>
                      <td></td>
                    </tr>
                  )}
                  <tr className={parseFloat(q.food_total) > 0 ? "" : "border-t border-border"}>
                    <td colSpan={5} className="pt-3 text-right text-muted-foreground">Subtotal</td>
                    <td className="pt-3 text-right font-medium">{formatCurrency(q.subtotal, cs)}</td>
                    <td></td>
                  </tr>
                  <tr>
                    <td colSpan={5} className="py-1 text-right text-muted-foreground">VAT ({(parseFloat(q.tax_rate) * 100).toFixed(0)}%)</td>
                    <td className="py-1 text-right">{formatCurrency(q.tax_amount, cs)}</td>
                    <td></td>
                  </tr>
                  <tr className="border-t border-border">
                    <td colSpan={5} className="pt-2 text-right font-semibold text-foreground">Total</td>
                    <td className="pt-2 text-right font-bold text-lg text-foreground">{formatCurrency(q.total, cs)}</td>
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
