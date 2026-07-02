"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { useParams, useRouter } from "next/navigation";
import Link from "next/link";
import { api, Contact, EventMealData } from "@/lib/api";
import { useQuote, useAccounts, useContacts, useSiteSettings, useDateFormat, useEventTypes, useServiceStyles, useMealTypes, useAllLeads, revalidate } from "@/lib/hooks";
import { formatDate, todayISO } from "@/lib/dateFormat";
import { formatCurrency } from "@/lib/utils";
import MenuBuilder from "@/components/MenuBuilder";
import AdditionalMealsEditor from "@/components/AdditionalMealsEditor";
import GuestCountField, { GuestCountValue } from "@/components/GuestCountField";
import BookingTimelineField from "@/components/BookingTimelineField";
import BookingDetailsForm, { BookingDetailsValue } from "@/components/BookingDetailsForm";
import { computeQuoteTotals, buildQuoteSavePayload, bookingMealRows, LineItemInput } from "@/lib/quoteTotals";
import AddOnItemsEditor from "@/components/AddOnItemsEditor";
import BookingTotalsCard from "@/components/BookingTotalsCard";
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
  const { data: orgContacts = [] } = useContacts();
  const { data: rawSettings } = useSiteSettings();
  const settings = rawSettings || { currency_symbol: "£", currency_code: "GBP", date_format: "DD/MM/YYYY", default_price_per_head: "0.00", target_food_cost_percentage: "30.00", price_rounding_step: "50", tax_label: "VAT", default_tax_rate: "0.2000" };
  const dateFormat = useDateFormat();
  const { data: eventTypes = [] } = useEventTypes();
  const { data: serviceStyles = [] } = useServiceStyles();
  const { data: mealTypes = [] } = useMealTypes();
  const { data: allLeads = [] } = useAllLeads();
  const leads = allLeads.filter((l) => !["won", "lost"].includes(l.status));
  const [saving, setSaving] = useState(false);
  const [editing, setEditing] = useState(false);
  const [error, setError] = useState("");
  const [editData, setEditData] = useState({
    primary_contact: "",
    is_b2b: false,
    account: "",
    event_date: "",
    gents: 0,
    ladies: 0,
    custom_split: false,
    big_eaters: false,
    big_eaters_percentage: 0,
    price_per_head: "",
    venue: "",
    venue_address: "",
    event_type: "",
    meal_type: "",
    booking_date: "",
    service_style: "",
    setup_time: "",
    guest_arrival_time: "",
    meal_time: "",
    end_time: "",
    tax_rate: "",
    valid_until: "",
    notes: "",
    internal_notes: "",
  });
  const [showAcceptConfirm, setShowAcceptConfirm] = useState(false);

  // Create mode state
  const [createData, setCreateData] = useState({
    lead: "",
    primary_contact: "",
    is_b2b: false,
    account: "",
    venue: "",
    venue_address: "",
    event_date: todayISO(),
    gents: 0,
    ladies: 0,
    custom_split: false,
    big_eaters: false,
    big_eaters_percentage: 0,
    price_per_head: "",
    event_type: "other",
    meal_type: "",
    booking_date: "",
    service_style: "",
    setup_time: "",
    guest_arrival_time: "",
    meal_time: "",
    end_time: "",
    tax_rate: "0.2000",
    valid_until: "",
    notes: "",
    internal_notes: "",
  });
  const [menuData, setMenuData] = useState<{
    dish_ids: number[];
    based_on_template: number | null;
  }>({ dish_ids: [], based_on_template: null });
  // Line items held locally and committed with the rest of the quote in one save
  const [editLineItems, setEditLineItems] = useState<LineItemInput[]>([]);
  const [createLineItems, setCreateLineItems] = useState<LineItemInput[]>([]);
  // Additional meals (parity with events) — committed in the same save.
  const [editMeals, setEditMeals] = useState<EventMealData[]>([]);
  const [createMeals, setCreateMeals] = useState<EventMealData[]>([]);

  // Default the per-head price from settings ONLY once a menu is chosen — otherwise
  // a no-menu quote silently carries a phantom food charge (the Q-59 bug).
  const defaultPriceApplied = useRef(false);
  useEffect(() => {
    const hasMenu = menuData.dish_ids.length > 0 || menuData.based_on_template !== null;
    if (isNew && hasMenu && rawSettings && parseFloat(rawSettings.default_price_per_head) > 0 && !defaultPriceApplied.current) {
      setCreateData((prev) => ({ ...prev, price_per_head: rawSettings.default_price_per_head }));
      defaultPriceApplied.current = true;
    }
  }, [isNew, rawSettings, menuData]);

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
    // A real business on the lead makes this B2B; a leftover "individual" account is ignored.
    const leadCompany = accounts.find((a) => a.id === selectedLead.account);
    const isBusiness = !!leadCompany && leadCompany.account_type !== "individual";
    setCreateData((prev) => ({
      ...prev,
      lead: leadId,
      is_b2b: isBusiness || prev.is_b2b,
      account: isBusiness ? String(selectedLead.account) : prev.account,
      event_date: selectedLead.event_date || prev.event_date,
      gents: selectedLead.guest_estimate ? Math.ceil(selectedLead.guest_estimate / 2) : prev.gents,
      ladies: selectedLead.guest_estimate ? Math.floor(selectedLead.guest_estimate / 2) : prev.ladies,
      event_type: selectedLead.event_type || prev.event_type,
      meal_type: selectedLead.meal_type || prev.meal_type,
      service_style: selectedLead.service_style || prev.service_style,
    }));
  }

  async function handleCreateQuoteSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!createData.event_date) {
      setError("Please set the event date.");
      return;
    }
    setSaving(true);
    setError("");
    try {
      const data = {
        lead: createData.lead ? Number(createData.lead) : null,
        primary_contact: createData.primary_contact ? Number(createData.primary_contact) : null,
        is_b2b: createData.is_b2b,
        account: createData.is_b2b && createData.account ? Number(createData.account) : null,
        venue: createData.venue ? Number(createData.venue) : null,
        venue_address: createData.venue_address,
        event_date: createData.event_date,
        gents: createData.gents,
        ladies: createData.ladies,
        guest_count: createData.gents + createData.ladies,
        big_eaters: createData.big_eaters,
        big_eaters_percentage: createData.big_eaters_percentage,
        price_per_head: createData.price_per_head ? createData.price_per_head : null,
        event_type: createData.event_type,
        meal_type: createData.meal_type || undefined,
        booking_date: createData.booking_date || null,
        service_style: createData.service_style || undefined,
        setup_time: createData.setup_time || null,
        guest_arrival_time: createData.guest_arrival_time || null,
        meal_time: createData.meal_time || null,
        end_time: createData.end_time || null,
        tax_rate: createData.tax_rate,
        valid_until: createData.valid_until || null,
        notes: createData.notes,
        internal_notes: createData.internal_notes,
        dish_ids: menuData.dish_ids,
        based_on_template: menuData.based_on_template,
        line_items: createLineItems,
        additional_meals: createMeals.map((m) => ({
          label: m.label, guest_count: m.guest_count, price_per_head: m.price_per_head || null,
          dish_ids: m.dishes, based_on_template: m.based_on_template, meal_time: m.meal_time || null, notes: m.notes,
        })),
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
      is_b2b: quote.is_b2b,
      account: quote.account ? String(quote.account) : "",
      event_date: quote.event_date,
      gents: quote.gents,
      ladies: quote.ladies,
      custom_split: !(quote.gents + quote.ladies === 0
        || (quote.gents === Math.ceil((quote.gents + quote.ladies) / 2)
          && quote.ladies === Math.floor((quote.gents + quote.ladies) / 2))),
      big_eaters: quote.big_eaters,
      big_eaters_percentage: quote.big_eaters_percentage,
      price_per_head: quote.price_per_head || "",
      venue: quote.venue ? String(quote.venue) : "",
      venue_address: quote.venue_address || "",
      event_type: quote.event_type,
      meal_type: quote.meal_type || "",
      booking_date: quote.booking_date || "",
      service_style: quote.service_style || "",
      setup_time: quote.setup_time ? quote.setup_time.slice(0, 16) : "",
      guest_arrival_time: quote.guest_arrival_time ? quote.guest_arrival_time.slice(0, 16) : "",
      meal_time: quote.meal_time ? quote.meal_time.slice(0, 16) : "",
      end_time: quote.end_time ? quote.end_time.slice(0, 16) : "",
      tax_rate: String(Math.round(parseFloat(quote.tax_rate) * 10000) / 100),
      valid_until: quote.valid_until || "",
      notes: quote.notes,
      internal_notes: quote.internal_notes,
    });
    setEditLineItems((quote.line_items || []).map((li) => ({
      id: li.id, variant: li.variant, category: li.category, description: li.description,
      quantity: li.quantity, unit: li.unit, unit_price: li.unit_price,
      sort_order: li.sort_order ?? 0,
    })));
    setMenuData({ dish_ids: quote.dishes || [], based_on_template: quote.based_on_template || null });
    setEditMeals((quote.additional_meals || []).map((m) => ({ ...m })));
    setEditing(true);
  }

  async function handleSaveQuote() {
    if (!quote) return;
    setSaving(true);
    setError("");
    try {
      await api.updateQuote(quote.id, buildQuoteSavePayload(editData, menuData, editLineItems, editMeals));
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

  // Adapters between the page's string form objects (primary_contact) and the
  // shared BookingDetailsForm's value (contact). Field names otherwise match.
  type BookingShape = {
    primary_contact: string; is_b2b: boolean; account: string; venue: string; venue_address: string;
    event_type: string; meal_type: string; service_style: string; booking_date: string; notes: string;
  };
  const toBdValue = (d: BookingShape): BookingDetailsValue => ({
    contact: d.primary_contact, is_b2b: d.is_b2b, account: d.account,
    venue: d.venue, venue_address: d.venue_address,
    event_type: d.event_type, meal_type: d.meal_type, service_style: d.service_style,
    booking_date: d.booking_date, notes: d.notes,
  });
  const fromBdPatch = (patch: Partial<BookingDetailsValue>): Partial<BookingShape> => {
    const { contact, ...rest } = patch;
    return contact !== undefined ? { ...rest, primary_contact: contact } : rest;
  };

  const selectClass = "flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring";

  // Create mode
  if (isNew) {
    const createTotals = computeQuoteTotals(
      createData.price_per_head, createData.gents + createData.ladies,
      parseFloat(createData.tax_rate || "0"), createLineItems, createMeals,
    );
    return (
      <div className="space-y-6">
        <div className="flex items-center gap-2 text-sm">
          <Link href="/quotes" className="text-primary hover:underline">&larr; Quotes</Link>
        </div>

        {error && <p className="text-destructive">{error}</p>}

        <form onSubmit={handleCreateQuoteSubmit} noValidate className="space-y-6">
          {/* Header */}
          <Card>
            <CardContent className="p-6">
              <h1 className="text-2xl font-bold text-foreground">New Quote</h1>
            </CardContent>
          </Card>

          {/* Customer & Event (shared booking details) */}
          <Card>
            <CardContent className="p-6">
              <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide mb-3">Customer &amp; Event</h2>
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
              <BookingDetailsForm
                value={toBdValue(createData)}
                onChange={(patch) => setCreateData((prev) => ({ ...prev, ...fromBdPatch(patch) }))}
                eventTypes={eventTypes}
                mealTypes={mealTypes}
                serviceStyles={serviceStyles}
                customerAddress={orgContacts.find((c) => String(c.id) === createData.primary_contact)?.address}
                eventDateSlot={
                  <div>
                    <label className="block text-sm font-medium text-foreground mb-1">Event Date *</label>
                    <ValidatedInput type="date" required value={createData.event_date} onChange={setCreate("event_date")} />
                  </div>
                }
              />
            </CardContent>
          </Card>

          {/* Timeline */}
          <Card>
            <CardContent className="p-6">
              <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide mb-3">Timeline</h2>
              <BookingTimelineField
                eventDate={createData.event_date}
                value={{ setup_time: createData.setup_time, guest_arrival_time: createData.guest_arrival_time, meal_time: createData.meal_time, end_time: createData.end_time }}
                onChange={(patch) => setCreateData((prev) => ({ ...prev, ...patch }))}
              />
            </CardContent>
          </Card>

          {/* Menu & Pricing */}
          <Card>
            <CardContent className="p-6">
              <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide mb-3">Menu &amp; Pricing</h2>
              <div className="mb-4">
                <GuestCountField
                  value={{ gents: createData.gents, ladies: createData.ladies, custom_split: createData.custom_split, big_eaters: createData.big_eaters, big_eaters_percentage: createData.big_eaters_percentage }}
                  onChange={(patch) => setCreateData((prev) => ({ ...prev, ...patch }))}
                />
              </div>
              <MenuBuilder
                selectedDishIds={menuData.dish_ids}
                basedOnTemplate={menuData.based_on_template}
                guestCount={(createData.gents + createData.ladies) || undefined}
                onChange={setMenuData}
                pricePerHead={createData.price_per_head}
                onPricePerHeadChange={(val) => setCreateData((prev) => ({ ...prev, price_per_head: val }))}
                currencySymbol={cs}
                priceRoundingStep={Number(settings.price_rounding_step) || 50}
              />
            </CardContent>
          </Card>

          {/* Additional Meals */}
          <AdditionalMealsEditor
            meals={createMeals}
            onChange={setCreateMeals}
            editing
            currencySymbol={cs}
            dateFormat={dateFormat}
            priceRoundingStep={Number(settings.price_rounding_step) || 50}
            defaultGuestCount={createData.gents + createData.ladies}
            eventDate={createData.event_date}
          />

          {/* Additional Items */}
          <Card>
            <CardContent className="p-6">
              <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide mb-3">Additional Items</h2>
              <AddOnItemsEditor
                items={createLineItems}
                onChange={setCreateLineItems}
                guestCount={createData.gents + createData.ladies}
                currencySymbol={cs}
              />
            </CardContent>
          </Card>

          {/* Quote Total (tax rate + menu + additional items) */}
          <BookingTotalsCard
            title="Quote Total"
            currencySymbol={cs}
            foodTotal={Math.round((parseFloat(createData.price_per_head) || 0) * (createData.gents + createData.ladies) * 100) / 100}
            foodLabel={`Food / Menu (${formatCurrency(createData.price_per_head || 0, cs)}/head × ${createData.gents + createData.ladies} guests)`}
            meals={bookingMealRows(createMeals, cs)}
            addOnsTotal={Math.round((createTotals.subtotal - createTotals.food_total) * 100) / 100}
            subtotal={createTotals.subtotal}
            taxAmount={createTotals.tax_amount}
            total={createTotals.total}
            taxLabel={settings.tax_label || "VAT"}
            taxPercent={(parseFloat(createData.tax_rate || "0") * 100).toFixed(0)}
            taxRateField={
              <div>
                <label className="block text-sm font-medium text-foreground mb-1">Tax Rate (%)</label>
                <ValidatedInput
                  type="number"
                  step="0.01"
                  min={0}
                  max={100}
                  value={Number.isNaN(parseFloat(createData.tax_rate)) ? "" : Math.round(parseFloat(createData.tax_rate) * 10000) / 100}
                  onChange={(e) => setCreateData({ ...createData, tax_rate: e.target.value === "" ? "0.0000" : (parseFloat(e.target.value) / 100).toFixed(4) })}
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
  const editGuestCount = (editData.gents + editData.ladies) || q.guest_count;
  const liveTotals = computeQuoteTotals(
    editData.price_per_head, editData.gents + editData.ladies,
    parseFloat(editData.tax_rate || "0") / 100, editLineItems,
    editing ? editMeals : (q.additional_meals || []),
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

      {/* Customer & Event (editing) — shared booking details */}
      {editing && (
        <Card>
          <CardContent className="p-6">
            <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide mb-3">Customer &amp; Event</h2>
            <BookingDetailsForm
              value={toBdValue(editData)}
              onChange={(patch) => setEditData((prev) => ({ ...prev, ...fromBdPatch(patch) }))}
              eventTypes={eventTypes}
              mealTypes={mealTypes}
              serviceStyles={serviceStyles}
              customerAddress={orgContacts.find((c) => String(c.id) === editData.primary_contact)?.address}
              eventDateSlot={
                <div>
                  <label className="block text-sm font-medium text-foreground mb-1">Event Date *</label>
                  <ValidatedInput type="date" required value={editData.event_date} onChange={setEdit("event_date")} />
                </div>
              }
            />
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
                {q.contact_name ? (
                  <div>
                    <span className="font-medium text-foreground">{q.contact_name}</span>
                    {q.contact_email && (
                      <span className="text-muted-foreground ml-2">{q.contact_email}</span>
                    )}
                    {q.contact_phone && (
                      <span className="text-muted-foreground ml-2">{q.contact_phone}</span>
                    )}
                  </div>
                ) : (
                  <div className="text-muted-foreground italic">No customer set</div>
                )}
                {q.is_b2b && q.account && (
                  <div>
                    <span className="text-muted-foreground">Business:</span>{" "}
                    <Link href={`/accounts/${q.account}`} className="text-primary hover:underline font-medium">{q.account_name}</Link>
                  </div>
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

      {/* Timeline (editing) */}
      {editing && (
        <Card>
          <CardContent className="p-6">
            <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide mb-3">Timeline</h2>
            <BookingTimelineField
              eventDate={editData.event_date}
              value={{ setup_time: editData.setup_time, guest_arrival_time: editData.guest_arrival_time, meal_time: editData.meal_time, end_time: editData.end_time }}
              onChange={(patch) => setEditData((prev) => ({ ...prev, ...patch }))}
            />
          </CardContent>
        </Card>
      )}

      {/* Menu */}
      <Card>
        <CardContent className="p-6">
          <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide mb-3">{editing ? "Menu & Pricing" : "Menu"}</h2>
          {editing ? (
            <>
              <div className="mb-4">
                <GuestCountField
                  value={{ gents: editData.gents, ladies: editData.ladies, custom_split: editData.custom_split, big_eaters: editData.big_eaters, big_eaters_percentage: editData.big_eaters_percentage }}
                  onChange={(patch) => setEditData((prev) => ({ ...prev, ...patch }))}
                />
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

      {/* Additional Meals */}
      {(editing || (q.additional_meals || []).length > 0) && (
        <AdditionalMealsEditor
          meals={editing ? editMeals : (q.additional_meals || [])}
          onChange={setEditMeals}
          editing={editing}
          currencySymbol={cs}
          dateFormat={dateFormat}
          priceRoundingStep={Number(settings.price_rounding_step) || 50}
          defaultGuestCount={editData.gents + editData.ladies}
          eventDate={editData.event_date}
        />
      )}

      {/* Additional Items */}
      <Card>
        <CardContent className="p-6">
          <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide mb-4">Additional Items</h2>
          {editing ? (
            <AddOnItemsEditor
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
      {(() => {
        const fullFood = editing ? liveTotals.food_total : parseFloat(q.food_total);
        const subtotal = editing ? liveTotals.subtotal : parseFloat(q.subtotal);
        const mealsList = editing ? editMeals : (q.additional_meals || []);
        const pph = parseFloat((editing ? editData.price_per_head : q.price_per_head) || "0") || 0;
        const guests = editing ? editGuestCount : q.guest_count;
        const mainFood = Math.round(pph * guests * 100) / 100;
        return (
      <BookingTotalsCard
        title="Quote Total"
        currencySymbol={cs}
        foodTotal={mainFood}
        foodLabel={`Food / Menu (${formatCurrency(editing ? editData.price_per_head : (q.price_per_head ?? 0), cs)}/head × ${editing ? editGuestCount : q.guest_count} guests)`}
        meals={bookingMealRows(mealsList, cs)}
        addOnsTotal={Math.round((subtotal - fullFood) * 100) / 100}
        subtotal={subtotal}
        taxAmount={editing ? liveTotals.tax_amount : parseFloat(q.tax_amount)}
        total={editing ? liveTotals.total : parseFloat(q.total)}
        taxLabel={settings.tax_label || "VAT"}
        taxPercent={editing ? parseFloat(editData.tax_rate || "0").toFixed(0) : (parseFloat(q.tax_rate) * 100).toFixed(0)}
        taxRateField={editing ? (
          <div>
            <label className="block text-sm font-medium text-foreground mb-1">Tax Rate (%)</label>
            <ValidatedInput type="number" step="0.01" min={0} max={100} value={editData.tax_rate} onChange={setEdit("tax_rate")} />
          </div>
        ) : undefined}
      />
        );
      })()}

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
