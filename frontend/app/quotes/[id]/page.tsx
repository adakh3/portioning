"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { useParams, useRouter } from "next/navigation";
import Link from "next/link";
import { api, Contact } from "@/lib/api";
import { useQuote, useAccounts, useVenues, useSiteSettings, useDateFormat, useEventTypes, useServiceStyles, useMealTypes, useAllLeads, revalidate } from "@/lib/hooks";
import { formatDate } from "@/lib/dateFormat";
import { formatCurrency } from "@/lib/utils";
import MenuBuilder from "@/components/MenuBuilder";
import { computeQuoteTotals, buildQuoteSavePayload, LineItemInput } from "@/lib/quoteTotals";
import QuoteLineItemsEditor from "@/components/QuoteLineItemsEditor";
import QuoteTotalsCard from "@/components/QuoteTotalsCard";
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
  const { data: allLeads = [] } = useAllLeads();
  const leads = allLeads.filter((l) => !["won", "lost"].includes(l.status));
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
  // Line items held locally and committed with the rest of the quote in one save
  const [editLineItems, setEditLineItems] = useState<LineItemInput[]>([]);
  const [createLineItems, setCreateLineItems] = useState<LineItemInput[]>([]);

  // Set default price from settings in create mode
  const defaultPriceApplied = useRef(false);
  useEffect(() => {
    if (isNew && rawSettings && parseFloat(rawSettings.default_price_per_head) > 0 && !defaultPriceApplied.current) {
      setCreateData((prev) => ({ ...prev, price_per_head: rawSettings.default_price_per_head }));
      defaultPriceApplied.current = true;
    }
  }, [isNew, rawSettings]);

  // Load contacts when account changes in create mode. The accounts LIST does
  // not include contacts, so fetch the account detail.
  useEffect(() => {
    if (!isNew) return;
    if (createData.account) {
      api.getAccount(Number(createData.account))
        .then((acct) => setCreateContacts(acct.contacts || []))
        .catch(() => setCreateContacts([]));
      setCreateData((prev) => ({ ...prev, primary_contact: "" }));
    } else {
      setCreateContacts([]);
    }
  }, [isNew, createData.account]);

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
        line_items: createLineItems,
      };
      const newQuote = await api.createQuote(data);
      revalidate("quotes");
      router.push(`/quotes/${newQuote.id}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to create quote");
    } finally {
      setSaving(false);
    }
  }
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
    setEditLineItems((quote.line_items || []).map((li) => ({
      id: li.id, category: li.category, description: li.description,
      quantity: li.quantity, unit: li.unit, unit_price: li.unit_price,
      is_taxable: li.is_taxable, sort_order: li.sort_order ?? 0,
    })));
    setMenuData({ dish_ids: quote.dishes || [], based_on_template: quote.based_on_template || null });
    if (quote.account) {
      api.getAccount(quote.account).then((acct) => setContacts(acct.contacts || [])).catch(() => {});
    }
    setEditing(true);
  }

  async function handleSaveQuote() {
    if (!quote) return;
    setSaving(true);
    setError("");
    try {
      await api.updateQuote(quote.id, buildQuoteSavePayload(editData, menuData, editLineItems));
      await mutateQuote();
      setEditing(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to save");
    } finally {
      setSaving(false);
    }
  }

  async function handleDeleteQuote() {
    if (!quote || !confirm("Delete this entire quote? This cannot be undone.")) return;
    try {
      await api.deleteQuote(quote.id);
      revalidate("quotes");
      router.push("/quotes");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to delete quote");
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
    const createTotals = computeQuoteTotals(
      createData.price_per_head, createData.guest_count,
      parseFloat(createData.tax_rate || "0"), createLineItems,
    );
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
                      {l.contact_name}{l.event_type_display ? ` — ${l.event_type_display}` : ""}{l.event_date ? ` (${formatDate(l.event_date, dateFormat)})` : ""}
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

          {/* Menu & Pricing */}
          <Card>
            <CardContent className="p-6">
              <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide mb-3">Menu &amp; Pricing</h2>
              <div className="mb-4 max-w-xs">
                <label className="block text-sm font-medium text-foreground mb-1">Guest Count *</label>
                <ValidatedInput type="number" required min={1} max={50000} value={createData.guest_count} onChange={setCreate("guest_count")} />
              </div>
              <MenuBuilder
                selectedDishIds={menuData.dish_ids}
                basedOnTemplate={menuData.based_on_template}
                guestCount={createData.guest_count ? Number(createData.guest_count) : undefined}
                onChange={setMenuData}
                pricePerHead={createData.price_per_head}
                onPricePerHeadChange={(val) => setCreateData((prev) => ({ ...prev, price_per_head: val }))}
                currencySymbol={cs}
                priceRoundingStep={Number(settings.price_rounding_step) || 50}
              />
            </CardContent>
          </Card>

          {/* Additional Items */}
          <Card>
            <CardContent className="p-6">
              <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide mb-3">Additional Items</h2>
              <QuoteLineItemsEditor
                items={createLineItems}
                onChange={setCreateLineItems}
                guestCount={createData.guest_count ? Number(createData.guest_count) : 0}
                currencySymbol={cs}
              />
            </CardContent>
          </Card>

          {/* Quote Total (tax rate + menu + additional items) */}
          <QuoteTotalsCard
            foodTotal={createTotals.food_total}
            subtotal={createTotals.subtotal}
            taxAmount={createTotals.tax_amount}
            total={createTotals.total}
            pricePerHead={createData.price_per_head}
            guestCount={createData.guest_count}
            taxPercent={(parseFloat(createData.tax_rate || "0") * 100).toFixed(0)}
            currencySymbol={cs}
            taxRateField={
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
            }
          />

          {/* Notes & validity */}
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
                <div>
                  <label className="block text-sm font-medium text-foreground mb-1">Valid Until</label>
                  <ValidatedInput type="date" value={createData.valid_until} onChange={setCreate("valid_until")} />
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
  const editGuestCount = editData.guest_count ? Number(editData.guest_count) : q.guest_count;
  const liveTotals = computeQuoteTotals(
    editData.price_per_head, editData.guest_count,
    parseFloat(editData.tax_rate || "0") / 100, editLineItems,
  );

  return (
    <div className="space-y-6">
      <Button variant="outline" size="sm" asChild>
        <Link href="/quotes">&larr; Back to Quotes</Link>
      </Button>

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
                Edit Quote
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
            <Button
              variant="outline"
              onClick={async () => {
                try {
                  const blob = await api.downloadQuotePDF(q.id);
                  const file = new File([blob], `Quote-${q.id}-v${q.version}.pdf`, { type: "application/pdf" });
                  const message = `Hi${q.contact_name ? ` ${q.contact_name.split(" ")[0]}` : ""}, please find attached your quotation (Quote #${q.id}, v${q.version}) for ${q.guest_count} guests on ${q.event_date ? formatDate(q.event_date, dateFormat) : "TBC"}. Total: ${formatCurrency(q.total, cs)}. Please don't hesitate to reach out if you have any questions.`;

                  if (navigator.share && navigator.canShare?.({ files: [file] })) {
                    await navigator.share({ text: message, files: [file] });
                  } else {
                    // Fallback: open WhatsApp Web with text only
                    const phone = q.contact_phone?.replace(/\D/g, "") || "";
                    const waUrl = phone
                      ? `https://wa.me/${phone}?text=${encodeURIComponent(message)}`
                      : `https://wa.me/?text=${encodeURIComponent(message)}`;
                    window.open(waUrl, "_blank");
                  }
                } catch (err) {
                  if (err instanceof Error && err.name === "AbortError") return; // user cancelled share
                  setError(err instanceof Error ? err.message : "Failed to share via WhatsApp");
                }
              }}
            >
              Share via WhatsApp
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
            <Button
              variant="outline"
              onClick={handleDeleteQuote}
              className="ml-auto border-destructive text-destructive hover:bg-destructive/10 hover:text-destructive"
            >
              Delete Quote
            </Button>
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

      {/* Customer (editing) — mirrors the create form layout */}
      {editing && (
        <Card>
          <CardContent className="p-6">
            <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide mb-3">Customer</h2>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium text-foreground mb-1">Contact Person</label>
                <select value={editData.primary_contact} onChange={setEdit("primary_contact")} className={selectClass}>
                  <option value="">-- No contact --</option>
                  {contacts.map((c) => <option key={c.id} value={c.id}>{c.name} ({c.role})</option>)}
                </select>
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Event (editing) */}
      {editing && (
        <Card>
          <CardContent className="p-6">
            <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide mb-3">Event Details</h2>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium text-foreground mb-1">Event Date *</label>
                <ValidatedInput type="date" required value={editData.event_date} onChange={setEdit("event_date")} />
              </div>
              <div>
                <label className="block text-sm font-medium text-foreground mb-1">Event Type</label>
                <select value={editData.event_type} onChange={setEdit("event_type")} className={selectClass}>
                  {eventTypes.map((et) => <option key={et.id} value={et.value}>{et.label}</option>)}
                </select>
              </div>
              <div>
                <label className="block text-sm font-medium text-foreground mb-1">Meal Type</label>
                <select value={editData.meal_type} onChange={setEdit("meal_type")} className={selectClass}>
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
                <select value={editData.service_style} onChange={setEdit("service_style")} className={selectClass}>
                  <option value="">-- None --</option>
                  {serviceStyles.map((ss) => <option key={ss.id} value={ss.value}>{ss.label}</option>)}
                </select>
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Venue (editing) */}
      {editing && (
        <Card>
          <CardContent className="p-6">
            <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide mb-3">Venue</h2>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium text-foreground mb-1">Venue</label>
                <select value={editData.venue} onChange={setEdit("venue")} className={selectClass}>
                  <option value="">-- No venue --</option>
                  {venues.map((v) => <option key={v.id} value={v.id}>{v.name}</option>)}
                </select>
              </div>
              <div>
                <label className="block text-sm font-medium text-foreground mb-1">Venue Address / Notes</label>
                <Textarea value={editData.venue_address} onChange={setEdit("venue_address")} rows={2} maxLength={300} placeholder="Freeform address or additional venue notes" />
              </div>
            </div>
          </CardContent>
        </Card>
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
                <span className="font-medium text-foreground">{formatDate(q.event_date, dateFormat)}</span>
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
          <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide mb-3">{editing ? "Menu & Pricing" : "Menu"}</h2>
          {editing ? (
            <>
              <div className="mb-4 max-w-xs">
                <label className="block text-sm font-medium text-foreground mb-1">Guest Count *</label>
                <ValidatedInput type="number" required min={1} max={50000} value={editData.guest_count} onChange={setEdit("guest_count")} />
              </div>
              <MenuBuilder
                selectedDishIds={menuData.dish_ids}
                basedOnTemplate={menuData.based_on_template}
                guestCount={editGuestCount}
                onChange={setMenuData}
                pricePerHead={editData.price_per_head}
                onPricePerHeadChange={(val) => setEditData((prev) => ({ ...prev, price_per_head: val }))}
                currencySymbol={cs}
                priceRoundingStep={Number(settings.price_rounding_step) || 50}
              />
            </>
          ) : (
            <MenuBuilder
              selectedDishIds={q.dishes || []}
              basedOnTemplate={q.based_on_template || null}
              guestCount={q.guest_count}
              disabled
              currencySymbol={cs}
              priceRoundingStep={Number(settings.price_rounding_step) || 50}
            />
          )}
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

      {/* Additional Items */}
      <Card>
        <CardContent className="p-6">
          <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide mb-4">Additional Items</h2>
          {editing ? (
            <QuoteLineItemsEditor
              items={editLineItems}
              onChange={setEditLineItems}
              guestCount={editGuestCount}
              currencySymbol={cs}
            />
          ) : q.line_items.length === 0 ? (
            <p className="text-muted-foreground text-sm">No additional items.</p>
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
                  </tr>
                </thead>
                <tbody>
                  {q.line_items.map((item) => (
                    <tr key={item.id} className="border-b border-border/50">
                      <td className="py-2">
                        <Badge variant="secondary" className="text-xs">{CATEGORY_LABELS[item.category] || item.category}</Badge>
                      </td>
                      <td className="py-2 text-foreground">{item.description}</td>
                      <td className="py-2 text-right text-foreground/80">{item.quantity}</td>
                      <td className="py-2 text-muted-foreground">{item.unit.replace(/_/g, " ")}</td>
                      <td className="py-2 text-right text-foreground/80">{formatCurrency(item.unit_price, cs)}</td>
                      <td className="py-2 text-right font-medium text-foreground">{formatCurrency(item.line_total, cs)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Quote Total (menu + additional items) */}
      <QuoteTotalsCard
        foodTotal={editing ? liveTotals.food_total : parseFloat(q.food_total)}
        subtotal={editing ? liveTotals.subtotal : parseFloat(q.subtotal)}
        taxAmount={editing ? liveTotals.tax_amount : parseFloat(q.tax_amount)}
        total={editing ? liveTotals.total : parseFloat(q.total)}
        pricePerHead={editing ? editData.price_per_head : (q.price_per_head ?? 0)}
        guestCount={editing ? editGuestCount : q.guest_count}
        taxPercent={editing ? parseFloat(editData.tax_rate || "0").toFixed(0) : (parseFloat(q.tax_rate) * 100).toFixed(0)}
        currencySymbol={cs}
        taxRateField={editing ? (
          <div>
            <label className="block text-sm font-medium text-foreground mb-1">Tax Rate (%)</label>
            <ValidatedInput type="number" step="0.01" min={0} max={100} value={editData.tax_rate} onChange={setEdit("tax_rate")} />
          </div>
        ) : undefined}
      />

      {editing && (
        <Card>
          <CardContent className="p-6">
            <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide mb-3">Notes</h2>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium text-foreground mb-1">Notes (customer-visible)</label>
                <Textarea value={editData.notes} onChange={setEdit("notes")} rows={3} maxLength={2000} />
              </div>
              <div>
                <label className="block text-sm font-medium text-foreground mb-1">Internal Notes</label>
                <Textarea value={editData.internal_notes} onChange={setEdit("internal_notes")} rows={3} maxLength={2000} />
              </div>
              <div>
                <label className="block text-sm font-medium text-foreground mb-1">Valid Until</label>
                <ValidatedInput type="date" value={editData.valid_until} onChange={setEdit("valid_until")} />
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      {editing && (
        <div className="sticky bottom-0 z-10 bg-background/95 backdrop-blur border-t border-border py-3 flex gap-3">
          <Button onClick={handleSaveQuote} disabled={saving}>
            {saving ? "Saving..." : "Save Quote"}
          </Button>
          <Button variant="outline" onClick={() => setEditing(false)} disabled={saving}>
            Cancel
          </Button>
        </div>
      )}
    </div>
  );
}
