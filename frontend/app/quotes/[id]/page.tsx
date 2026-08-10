"use client";

import { useState, useEffect, useCallback, useMemo, useRef } from "react";
import { useParams, useRouter } from "next/navigation";
import Link from "next/link";
import { api, ChannelAvailability, ClientChannel, ClientMessageKind, Contact, EventMealData, CourseData, MenuChoices } from "@/lib/api";
import { useQuote, useAccounts, useContacts, useSiteSettings, useDateFormat, useFormatDateTime, useEventTypes, useServiceStyles, useMealTypes, useTimelinePresets, useAllLeads, useProductLines, useUsers, useClientMessages, useMessagingStatus, revalidate } from "@/lib/hooks";
import { useAuth } from "@/lib/auth";
import { formatDate, formatInstantDate, todayISO } from "@/lib/dateFormat";
import { formatCurrency, formatPercent } from "@/lib/utils";
import MenuBuilder from "@/components/MenuBuilder";
import AdditionalMealsEditor from "@/components/AdditionalMealsEditor";
import { guestsChoose } from "@/lib/menuStructure";
import GuestCountField, { GuestCountValue } from "@/components/GuestCountField";
import SegmentRatesField from "@/components/SegmentRatesField";
import BookingTimelineField, { TimelineEntryValue } from "@/components/BookingTimelineField";
import BookingTimelineView from "@/components/BookingTimelineView";
import BookingDetailsForm, { BookingDetailsValue } from "@/components/BookingDetailsForm";
import AssigneePicker from "@/components/AssigneePicker";
import SearchableSelect from "@/components/SearchableSelect";
import { timelineMealRows, hasVendorDoubleEntry, segmentFood, segmentFoodRows, bookingMealRows } from "@/lib/quoteTotals";
import { buildQuoteSavePayload, pricingDraft, taxRatePercent, taxRateFraction, LineItemInput, GuestSegmentMeta } from "@/lib/bookingPayload";
import { usePricingPreview } from "@/lib/usePricingPreview";
import { previewCardProps, storedCardProps, type PreviewCardProps } from "@/lib/previewCard";
import AddOnItemsEditor from "@/components/AddOnItemsEditor";
import BookingTotalsCard from "@/components/BookingTotalsCard";
import ESignPanel from "@/components/ESignPanel";
import SendToClientModal from "@/components/SendToClientModal";
import ClientMessages from "@/components/ClientMessages";
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
  const settings = rawSettings || { currency_symbol: "", currency_code: "", date_format: "MM/DD/YYYY", default_price_per_head: "0.00", target_food_cost_percentage: "30.00", price_rounding_step: "50", tax_label: "", default_tax_rate: "0.0000" };
  const segmentMeta = (rawSettings?.guest_segments ?? []) as GuestSegmentMeta[];
  const dateFormat = useDateFormat();
  const timeFormat: "12h" | "24h" = ((rawSettings as { time_format?: string } | undefined)?.time_format === "12h") ? "12h" : "24h";
  const { data: users = [] } = useUsers();
  const { user: currentUser } = useAuth();
  const salespeople = users.filter((u) => u.role === "salesperson");
  // Assignee options: salespeople, plus the current user if they aren't one, so
  // an admin creating a quote can still credit themselves.
  const assigneeOptions = currentUser && !salespeople.some((u) => u.id === currentUser.id)
    ? [{ id: currentUser.id, first_name: currentUser.first_name, last_name: currentUser.last_name }, ...salespeople]
    : salespeople;
  const { data: productLines = [] } = useProductLines();
  const activeProducts = productLines.filter((p) => p.is_active);
  const { data: eventTypes = [] } = useEventTypes();
  const { data: serviceStyles = [] } = useServiceStyles();
  const serviceStyleLabels: Record<string, string> = Object.fromEntries(serviceStyles.map((ss) => [ss.value, ss.label]));
  const { data: mealTypes = [] } = useMealTypes();
  const { data: timelinePresets = [] } = useTimelinePresets();
  const { data: allLeads = [] } = useAllLeads();
  const leads = allLeads.filter((l) => !["won", "lost"].includes(l.status));
  const formatDateTime = useFormatDateTime();
  const quoteId = isNew ? null : (Number(id) || null);
  const { data: clientMessages = [], isLoading: messagesLoading, mutate: mutateMessages } = useClientMessages("quote", quoteId);
  // What this client can be reached on is decided by the backend; the page
  // renders that answer rather than working it out from Twilio/mailbox flags.
  const { data: messagingStatus } = useMessagingStatus("quote", quoteId);
  const [saving, setSaving] = useState(false);
  const [editing, setEditing] = useState(false);
  // One send surface for this quote (REL-445 AC2b) — the old "Share via
  // WhatsApp" button and its "did you send it?" confirmation are gone.
  const [sendKind, setSendKind] = useState<ClientMessageKind | null>(null);
  const [sendPrefill, setSendPrefill] = useState<{ channel: ClientChannel; subject: string; body: string } | null>(null);
  const [toast, setToast] = useState("");
  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(""), 4000);
    return () => clearTimeout(t);
  }, [toast]);
  const [error, setError] = useState("");
  const [editData, setEditData] = useState({
    primary_contact: "",
    is_b2b: false,
    account: "",
    event_date: "",
    guest_count: 0,
    segment_counts: {} as Record<string, number>,
    segment_prices: {} as Record<string, string>,
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
    product: "",
    tax_rate: "",
    service_charge_pct: "0",
    service_charge_taxable: true,
    gratuity_pct: "0",
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
    guest_count: 0,
    segment_counts: {} as Record<string, number>,
    segment_prices: {} as Record<string, string>,
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
    product: "",
    // PERCENT, like the edit form and like the field the user types into. The
    // create form used to hold a fraction here while displaying percent, so the
    // two modes disagreed about what `tax_rate` meant; `bookingPayload.ts` owns
    // the single conversion to the stored fraction now.
    tax_rate: "20",
    service_charge_pct: "0",
    service_charge_taxable: true,
    gratuity_pct: "0",
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
  // Courses (Starter/Entrée/Dessert) + dish→course map (REL-417).
  const [editCourses, setEditCourses] = useState<CourseData[]>([]);
  const [editDishCourses, setEditDishCourses] = useState<Record<string, number>>({});
  const [createCourses, setCreateCourses] = useState<CourseData[]>([]);
  const [createDishCourses, setCreateDishCourses] = useState<Record<string, number>>({});
  // Which dishes are offered as a menu choice (REL-419). Counts stay null here —
  // the tallies arrive with the final guarantee, on the event.
  const [editMenuChoices, setEditMenuChoices] = useState<MenuChoices>({});
  const [createMenuChoices, setCreateMenuChoices] = useState<MenuChoices>({});
  const [editTimeline, setEditTimeline] = useState<TimelineEntryValue[]>([]);
  const [createTimeline, setCreateTimeline] = useState<TimelineEntryValue[]>([]);
  // New-quote owner (existing quotes reassign via the header's instant-save select).
  const [formAssigned, setFormAssigned] = useState<number | null>(null);
  useEffect(() => {
    if (isNew && formAssigned === null && currentUser) setFormAssigned(currentUser.id);
  }, [isNew, currentUser, formAssigned]);

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

  // Seed the tax rate + service charge / gratuity from the ORG defaults once
  // settings load, so a new quote reflects the org's pricing (e.g. a US org's
  // 20% service charge) — not hardcoded values.
  const defaultTaxApplied = useRef(false);
  useEffect(() => {
    if (isNew && rawSettings && !defaultTaxApplied.current) {
      setCreateData((prev) => ({
        ...prev,
        // The org default is stored as a fraction; the form speaks percent.
        tax_rate: rawSettings.default_tax_rate != null ? taxRatePercent(rawSettings.default_tax_rate) : prev.tax_rate,
        service_charge_pct: rawSettings.service_charge_default_pct ?? prev.service_charge_pct,
        service_charge_taxable: rawSettings.service_charge_taxable_default ?? prev.service_charge_taxable,
        gratuity_pct: rawSettings.gratuity_default_pct ?? prev.gratuity_pct,
      }));
      defaultTaxApplied.current = true;
    }
  }, [isNew, rawSettings]);

  // Default the product to the org's first active line once it loads (unless a
  // lead already set one) — so a non-lead quote still gets a product.
  const defaultProductApplied = useRef(false);
  useEffect(() => {
    if (isNew && activeProducts.length > 0 && !defaultProductApplied.current) {
      defaultProductApplied.current = true;
      const def = activeProducts.find((p) => p.is_default) || activeProducts[0];
      setCreateData((prev) => (prev.product ? prev : { ...prev, product: String(def.id) }));
    }
  }, [isNew, activeProducts]);

  // ── Server-priced totals ──
  //
  // The page no longer works out what a quote costs. It sends the draft to the
  // pricing engine and renders the answer, so the figure on screen, the figure
  // that saves and the figure on the PDF are the same figure by construction.
  //
  // The draft is narrowed from the SAVE payload rather than assembled separately
  // — priced input and stored input are then the same object, and a create form
  // that quietly sent a different shape than the edit form (which is what used to
  // happen) can't come back.
  //
  // `null` in view mode: nothing is being edited, so the stored totals stand.
  const previewDraft = useMemo(() => {
    if (!isNew && !editing) return null;
    const form = isNew ? createData : editData;
    const save = buildQuoteSavePayload(
      form, menuData,
      isNew ? createLineItems : editLineItems,
      isNew ? createMeals : editMeals,
      segmentMeta,
    );
    return pricingDraft(save, {
      // The form has no taxable switch — a quote is taxed unless something else
      // (admin, API, import) turned it off, and that flag is not ours to change
      // here. Sending it keeps the preview honest about a quote it did not set.
      is_taxable: isNew ? true : (quote?.is_taxable ?? true),
      tax_rate: save.tax_rate,
    });
  }, [isNew, editing, createData, editData, menuData, createLineItems, editLineItems, createMeals, editMeals, segmentMeta, quote?.is_taxable]);
  const { result: preview, isStale: previewStale, error: previewError, flush: repriceNow } = usePricingPreview(previewDraft);

  const setCreate = (field: string) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) =>
    setCreateData({ ...createData, [field]: e.target.value });

  /** Prefill the quote from a lead. Takes the id directly — it never wanted the
   * event, only `target.value`, and the picker isn't a <select> any more. */
  function handleLeadSelect(leadId: string) {
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
      guest_count: selectedLead.guest_estimate || prev.guest_count,
      segment_counts: selectedLead.guest_estimate ? {} : prev.segment_counts,
      segment_prices: selectedLead.guest_estimate ? {} : prev.segment_prices,
      event_type: selectedLead.event_type || prev.event_type,
      meal_type: selectedLead.meal_type || prev.meal_type,
      service_style: selectedLead.service_style || prev.service_style,
      // Carry the lead's product across, like every other detail.
      product: selectedLead.product ? String(selectedLead.product) : prev.product,
    }));
  }

  async function handleCreateQuoteSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!createData.event_date) {
      setError("Please set the event date.");
      return;
    }
    // Customer and business used to be enforced by `required` on a native
    // <select>. The pickers are searchable now — buttons, not form controls — so
    // the requirement lives here, the same way the event form already states it.
    if (!createData.primary_contact) {
      setError("Customer is required");
      return;
    }
    if (createData.is_b2b && !createData.account) {
      setError("A business is required for a B2B quote");
      return;
    }
    setSaving(true);
    setError("");
    try {
      // The SAME builder the edit form saves through. Create used to assemble its
      // own literal, and the two drifted exactly where you'd expect: raw line
      // items instead of serialized ones, and a tax fraction where edit sent a
      // converted percent. `lead` and `assigned_to` are the only create-only
      // fields — everything else is a quote, whichever screen made it.
      const data = {
        ...buildQuoteSavePayload(
          createData, menuData, createLineItems, createMeals, segmentMeta,
          createTimeline, createCourses, createDishCourses, createMenuChoices,
        ),
        lead: createData.lead ? Number(createData.lead) : null,
        assigned_to: formAssigned || null,
      };
      const newQuote = await api.createQuote(data);
      revalidate("quotes");
      router.push(`/quotes/${newQuote.id}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to create quote");
      window.scrollTo({ top: 0, behavior: "smooth" }); // bring the error banner into view
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
      guest_count: quote.guest_count,
      // Rehydrate the explicit per-segment breakdown from the saved rows. The
      // default segment's entry is ignored downstream (it's the derived remainder).
      segment_counts: Object.fromEntries((quote.guest_counts ?? []).map((r) => [r.segment, r.count])),
      segment_prices: Object.fromEntries((quote.guest_counts ?? []).filter((r) => r.price_per_head != null).map((r) => [r.segment, String(r.price_per_head)])),
      big_eaters: quote.big_eaters,
      big_eaters_percentage: quote.big_eaters_percentage,
      price_per_head: quote.price_per_head || "",
      venue: quote.venue ? String(quote.venue) : "",
      venue_address: quote.venue_address || "",
      event_type: quote.event_type,
      product: quote.product ? String(quote.product) : "",
      meal_type: quote.meal_type || "",
      booking_date: quote.booking_date || "",
      service_style: quote.service_style || "",
      setup_time: quote.setup_time ? quote.setup_time.slice(0, 16) : "",
      guest_arrival_time: quote.guest_arrival_time ? quote.guest_arrival_time.slice(0, 16) : "",
      meal_time: quote.meal_time ? quote.meal_time.slice(0, 16) : "",
      end_time: quote.end_time ? quote.end_time.slice(0, 16) : "",
      tax_rate: taxRatePercent(quote.tax_rate),
      service_charge_pct: quote.service_charge_pct ?? "0",
      service_charge_taxable: quote.service_charge_taxable ?? true,
      gratuity_pct: quote.gratuity_pct ?? "0",
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
    setEditCourses(quote.courses || []);
    setEditDishCourses(quote.dish_courses || {});
    setEditMenuChoices(quote.menu_choices || {});
    setEditTimeline((quote.timeline_entries || []).map((e) => ({
      id: e.id, time: e.time.slice(0, 5), label: e.label, date: e.date || "",
    })));
    setEditing(true);
  }

  async function handleAssign(value: string) {
    if (!quote) return;
    setSaving(true);
    try {
      await api.updateQuote(quote.id, { assigned_to: value ? Number(value) : null });
      await mutateQuote();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Reassign failed");
    } finally {
      setSaving(false);
    }
  }

  async function handleProductChange(value: string) {
    if (!quote) return;
    setSaving(true);
    try {
      await api.updateQuote(quote.id, { product: value ? Number(value) : null });
      await mutateQuote();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to set product");
    } finally {
      setSaving(false);
    }
  }

  async function handleSaveQuote() {
    if (!quote) return;
    setSaving(true);
    setError("");
    try {
      await api.updateQuote(quote.id, buildQuoteSavePayload(editData, menuData, editLineItems, editMeals, segmentMeta, editTimeline, editCourses, editDishCourses, editMenuChoices));
      await mutateQuote();
      setEditing(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to save");
      window.scrollTo({ top: 0, behavior: "smooth" }); // bring the error banner into view
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
    event_type: string; meal_type: string; service_style: string; booking_date: string; product: string; notes: string;
  };
  const toBdValue = (d: BookingShape): BookingDetailsValue => ({
    contact: d.primary_contact, is_b2b: d.is_b2b, account: d.account,
    venue: d.venue, venue_address: d.venue_address,
    event_type: d.event_type, meal_type: d.meal_type, service_style: d.service_style,
    booking_date: d.booking_date, product: d.product, notes: d.notes,
  });
  const fromBdPatch = (patch: Partial<BookingDetailsValue>): Partial<BookingShape> => {
    const { contact, ...rest } = patch;
    return contact !== undefined ? { ...rest, primary_contact: contact } : rest;
  };


  /** What the totals card shows before the engine has ever answered.
   *
   * A brand-new quote is worth nothing until it's priced, so zeros are the honest
   * opening state — and they are replaced, not added to, by the first response. */
  const ZERO_CARD: PreviewCardProps = {
    foodTotal: "0", foodRows: null, meals: [], addOnsTotal: "0", subtotal: "0",
    serviceCharge: "0", taxAmount: "0", gratuity: "0", total: "0",
  };

  /** Shown next to the title when the figures are behind the form. Only a failed
   * refresh earns words — an in-flight one is already saying so by dimming. */
  const staleHint = previewError ? "Totals will refresh shortly" : undefined;

  /** Why this draft would be refused if saved, in the save path's own words.
   *
   * The endpoint prices drafts honestly, including ones the save rejects — a
   * breakdown covering more guests than the booking claims prices happily and
   * then 400s. Without this the card shows a confident figure that cannot exist,
   * and the user finds out only when Save fails. */
  const previewWarnings = (editing || isNew) ? (preview?.warnings ?? []) : [];
  const warningBanner = previewWarnings.length > 0 ? (
    <div role="alert" className="rounded-md border border-warning/40 bg-warning/10 px-4 py-3 text-sm font-medium text-warning-foreground">
      {previewWarnings.map((w, i) => <p key={i}>{w}</p>)}
    </div>
  ) : null;

  /** The view-mode card for a quote saved BEFORE REL-464, which carries no
   * pricing snapshot and never will (nothing backfills them).
   *
   * This is the pre-REL-465 rendering, kept verbatim and reachable only here. The
   * flat total columns alone cannot say which meals were charged or how the
   * segments were priced, so building the card from them drops the meal rows and
   * the itemisation entirely — on a quote the customer has already accepted. The
   * mirror is wrong to keep and worse to lose, so it stays until every row has
   * been saved again, and dies with the rest of `quoteTotals.ts` in step 6. */
  function legacyCardProps(quoteRow: NonNullable<typeof quote>): PreviewCardProps {
    const segCounts = Object.fromEntries((quoteRow.guest_counts ?? []).map((r) => [r.segment, r.count]));
    const segPrices = Object.fromEntries(
      (quoteRow.guest_counts ?? [])
        .filter((r) => r.price_per_head != null)
        .map((r) => [r.segment, String(r.price_per_head)]),
    );
    const pph = quoteRow.price_per_head ?? "0";
    const menuFood = segmentFood(pph, quoteRow.guest_count, segCounts, segmentMeta, segPrices);
    return {
      foodTotal: String(menuFood),
      foodRows: segmentFoodRows(pph, quoteRow.guest_count, segCounts, segmentMeta, segPrices),
      meals: bookingMealRows(quoteRow.additional_meals || [], cs, quoteRow.guest_count, segCounts, segmentMeta),
      // The add-ons line, recovered from the two columns that do record it.
      addOnsTotal: String(Number(quoteRow.subtotal) - Number(quoteRow.food_total)),
      subtotal: quoteRow.subtotal,
      serviceCharge: quoteRow.service_charge || "0",
      taxAmount: quoteRow.tax_amount,
      gratuity: quoteRow.gratuity || "0",
      total: quoteRow.total,
    };
  }

  // Create mode
  if (isNew) {
    const createCard = preview ? previewCardProps(preview, cs) : ZERO_CARD;
    return (
      <div className="space-y-6">
        <div className="flex items-center gap-2 text-sm">
          <Link href="/quotes" className="text-primary hover:underline">&larr; Quotes</Link>
        </div>

        {error && (
          <div role="alert" className="rounded-md border border-destructive/40 bg-destructive/10 px-4 py-3 text-sm font-medium text-destructive">
            {error}
          </div>
        )}

        <form onSubmit={handleCreateQuoteSubmit} noValidate className="space-y-6">
          {/* Header */}
          <Card>
            <CardContent className="p-6">
              <div className="flex items-end gap-3 flex-wrap">
                <h1 className="text-2xl font-bold text-foreground self-center">New Quote</h1>
                <AssigneePicker value={formAssigned} options={assigneeOptions} onChange={setFormAssigned} />
                {activeProducts.length > 0 && (
                  <div className="flex flex-col gap-1">
                    <label className="text-xs font-medium text-muted-foreground">Product</label>
                    <select value={createData.product} onChange={setCreate("product")} aria-label="Product line"
                      className="flex h-9 rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring">
                      {activeProducts.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
                    </select>
                  </div>
                )}
              </div>
            </CardContent>
          </Card>

          {/* Customer & Event (shared booking details) */}
          <Card>
            <CardContent className="p-6">
              <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide mb-3">Event Details</h2>
              <div className="mb-4">
                <label className="block text-sm font-medium text-foreground mb-1">Link to Lead</label>
                {/* Searchable, not a native select: this list is every open lead the
                    org has, so it grows forever — at fifty it was a screen-height
                    scroll to hunt for a name. The event type and date move to a
                    second line, where they disambiguate two leads with the same
                    contact name instead of padding one long string. */}
                <SearchableSelect
                  ariaLabel="Link to Lead"
                  placeholder="Search leads by name, type or date…"
                  emptyLabel="-- No lead (standalone quote) --"
                  value={createData.lead}
                  onChange={handleLeadSelect}
                  options={leads.map((l) => ({
                    value: String(l.id),
                    label: l.contact_name,
                    hint: [
                      l.event_type_display,
                      l.event_date ? formatDate(l.event_date, dateFormat) : "",
                    ].filter(Boolean).join(" · "),
                  }))}
                />
              </div>
              <BookingDetailsForm
                value={toBdValue(createData)}
                onChange={(patch) => setCreateData((prev) => ({ ...prev, ...fromBdPatch(patch) }))}
                eventTypes={eventTypes}
                mealTypes={mealTypes}
                serviceStyles={serviceStyles}
                productLines={activeProducts}
                showProduct={false}
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

          {/* Guests — entered once; every meal draws from this */}
          <Card>
            <CardContent className="p-6">
              <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide mb-3">Guests</h2>
              <GuestCountField
                value={{ guest_count: createData.guest_count, segment_counts: createData.segment_counts, segment_prices: createData.segment_prices, big_eaters: createData.big_eaters, big_eaters_percentage: createData.big_eaters_percentage }}
                onChange={(patch) => setCreateData((prev) => ({ ...prev, ...patch }))}
              />
              {hasVendorDoubleEntry(createData.segment_counts, createMeals, segmentMeta) && (
                <div role="alert" className="mt-2 flex items-start gap-2 rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-xs font-medium text-amber-800 dark:border-amber-700 dark:bg-amber-950/40 dark:text-amber-300">
                  <span aria-hidden="true" className="text-sm leading-none">⚠️</span>
                  <span>Possible double-count: you have <strong>vendor covers</strong> and a <strong>vendor-labelled meal</strong>. Vendors should be counted one way or the other, not both.</span>
                </div>
              )}
            </CardContent>
          </Card>

          {/* Menu & Pricing — the main meal (serves everyone) */}
          <Card>
            <CardContent className="p-6">
              <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide mb-3">Menu &amp; Pricing</h2>
              <MenuBuilder
                selectedDishIds={menuData.dish_ids}
                basedOnTemplate={menuData.based_on_template}
                guestCount={createData.guest_count}
                onChange={setMenuData}
                onLoadCourses={(courses, dishCourses) => { setCreateCourses(courses); setCreateDishCourses(dishCourses); }}
                courses={createCourses}
                dishCourses={createDishCourses}
                menuChoices={createMenuChoices}
                guestsChoose={guestsChoose(createData.service_style, serviceStyles)}
                bigEaters={createData.big_eaters}
                bigEatersPercentage={createData.big_eaters_percentage}
                serviceStyleLabel={serviceStyleLabels[createData.service_style]}
                onStructureChange={({ courses, dishCourses, menuChoices }) => {
                  setCreateCourses(courses);
                  setCreateDishCourses(dishCourses);
                  setCreateMenuChoices(menuChoices);
                }}
                pricePerHead={createData.price_per_head}
                onPricePerHeadChange={(val) => setCreateData((prev) => ({ ...prev, price_per_head: val }))}
                currencySymbol={cs}
                priceRoundingStep={Number(settings.price_rounding_step) || 50}
              />
              {/* Per-segment rates live beside the Price/head they derive from, not
                  in the Guests card which is filled in before pricing (REL-428). */}
              <SegmentRatesField
                segmentPrices={createData.segment_prices}
                onChange={(patch) => setCreateData((prev) => ({ ...prev, ...patch }))}
                pricePerHead={createData.price_per_head}
                currencySymbol={cs}
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
            defaultGuestCount={createData.guest_count}
            eventDate={createData.event_date}
            timeFormat={timeFormat}
            guestCount={createData.guest_count}
            segmentCounts={createData.segment_counts}
            segmentMeta={segmentMeta}
          />

          {/* Timeline — below the meals: the run-of-show is built around the meal
              times, so it reads after you've said what's being served (REL-430). */}
          <Card>
            <CardContent className="p-6">
              <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide mb-3">Timeline</h2>
              <BookingTimelineField
                eventDate={createData.event_date}
                timeFormat={timeFormat}
                value={{ setup_time: createData.setup_time, guest_arrival_time: createData.guest_arrival_time, meal_time: createData.meal_time, end_time: createData.end_time }}
                onChange={(patch) => setCreateData((prev) => ({ ...prev, ...patch }))}
                entries={createTimeline}
                onEntriesChange={setCreateTimeline}
                presets={timelinePresets}
                meals={timelineMealRows(createMeals)}
              />
            </CardContent>
          </Card>

          {/* Additional Items */}
          <Card>
            <CardContent className="p-6">
              <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide mb-3">Additional Items</h2>
              <AddOnItemsEditor
                items={createLineItems}
                onChange={setCreateLineItems}
                guestCount={createData.guest_count}
                currencySymbol={cs}
              />
            </CardContent>
          </Card>

          {/* Quote Total (tax rate + menu + additional items) */}
          {warningBanner}
          <BookingTotalsCard
            title="Quote Total"
            currencySymbol={cs}
            {...createCard}
            foodLabel={`Food / Menu (${formatCurrency(createData.price_per_head || 0, cs)}/head × ${createData.guest_count} guests)`}
            serviceChargeControl={
              <span className="flex items-center gap-1">
                Service charge
                <ValidatedInput type="number" step="0.01" min={0} max={100} className="w-16 h-7"
                  value={createData.service_charge_pct}
                  onBlur={repriceNow}
                  onChange={(e) => setCreateData({ ...createData, service_charge_pct: e.target.value })} />
                %
              </span>
            }
            gratuityControl={
              <span className="flex items-center gap-1">
                Gratuity
                <ValidatedInput type="number" step="0.01" min={0} max={100} className="w-16 h-7"
                  value={createData.gratuity_pct}
                  onBlur={repriceNow}
                  onChange={(e) => setCreateData({ ...createData, gratuity_pct: e.target.value })} />
                %
              </span>
            }
            taxLabel={settings.tax_label}
            // Through the SAME conversion the payload uses, so the label states the
            // rate that will be charged: formatting the raw form string showed
            // "7.375%" beside tax actually taken at 7.376%.
            taxPercent={formatPercent(taxRatePercent(taxRateFraction(createData.tax_rate)))}
            taxRateField={
              <div>
                <label htmlFor="create-tax-rate" className="block text-sm font-medium text-foreground mb-1">Tax Rate (%)</label>
                <ValidatedInput
                  id="create-tax-rate"
                  type="number"
                  // 0.001: NYC's 8.875% is a real rate, and step="0.01" makes the
                  // browser refuse it outright.
                  step="0.001"
                  min={0}
                  max={100}
                  value={createData.tax_rate}
                  onBlur={repriceNow}
                  onChange={setCreate("tax_rate")}
                />
              </div>
            }
            isStale={previewStale}
            staleHint={staleHint}
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
  const editGuestCount = editData.guest_count || q.guest_count;

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
              <div className="flex items-end gap-3 flex-wrap">
                <div className="flex items-center gap-3">
                  <h1 className="text-2xl font-bold text-foreground">Quote #{q.id} v{q.version}</h1>
                  <Badge variant={STATUS_BADGE_VARIANT[q.status] || "secondary"}>
                    {q.status_display}
                  </Badge>
                </div>
                <AssigneePicker
                  value={q.assigned_to}
                  currentName={q.assigned_to_name}
                  disabled={saving}
                  onChange={(pid) => handleAssign(pid ? String(pid) : "")}
                  options={(() => {
                    const opts = [...salespeople];
                    if (q.assigned_to && !opts.some((u) => u.id === q.assigned_to)) {
                      opts.unshift({ id: q.assigned_to, first_name: q.assigned_to_name || "Assigned", last_name: "", role: "" } as (typeof salespeople)[number]);
                    }
                    return opts;
                  })()}
                />
                {activeProducts.length > 0 && (
                  <div className="flex flex-col gap-1">
                    <label className="text-xs font-medium text-muted-foreground">Product</label>
                    <select
                      value={q.product ?? ""}
                      onChange={(e) => handleProductChange(e.target.value)}
                      disabled={saving}
                      title="Product line for this quote"
                      aria-label="Product line"
                      className="flex h-9 rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                    >
                      {activeProducts.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
                    </select>
                  </div>
                )}
              </div>
              <p className="text-sm text-muted-foreground mt-1">
                Created {formatInstantDate(q.created_at, dateFormat)}
                {q.sent_at && ` · Sent ${formatInstantDate(q.sent_at, dateFormat)}`}
                {q.accepted_at && ` · Accepted ${formatInstantDate(q.accepted_at, dateFormat)}`}
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
            {!["declined", "expired"].includes(q.status) && (
              <Button
                // Filled on a draft (the one thing to do next), outline once
                // sent — by then it's a resend and accepting is the primary.
                variant={q.status === "draft" ? "default" : "outline"}
                onClick={() => { setSendPrefill(null); setSendKind("sign_link"); }}
              >
                Send to Client
              </Button>
            )}
            {q.status === "draft" && (
              <>
                <Button variant="outline" onClick={() => handleTransition("sent")} disabled={saving}>
                  {saving ? "..." : "Mark as Sent"}
                </Button>
                {/* Outline on a draft: accepting a quote the client hasn't seen
                    is the rarer path, and one filled button per screen. */}
                <Button variant="outline" onClick={() => setShowAcceptConfirm(true)} disabled={saving}>
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

          {/* Client e-signature — available on any live quote (send link, or the
              signed status). Shown for accepted quotes too so an accepted-but-
              unsigned quote can still request a signature rather than dead-end. */}
          {!editing && !["declined", "expired"].includes(q.status) && (
            <ESignPanel kind="quote" id={q.id} publicToken={q.public_token} signature={q.signature} />
          )}

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

      {/* Client messages — everything this client has been sent about this
          quote, in one place (AC8). Hidden while editing to keep that view on
          the form. */}
      {!editing && quoteId && (
        <ClientMessages
          messages={clientMessages}
          isLoading={messagesLoading}
          formatDateTime={formatDateTime}
          onCompose={() => { setSendPrefill(null); setSendKind("compose"); }}
          onReopen={(row) => { setSendPrefill(row); setSendKind("compose"); }}
        />
      )}

      {/* Customer & Event (editing) — shared booking details */}
      {editing && (
        <Card>
          <CardContent className="p-6">
            <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide mb-3">Event Details</h2>
            <BookingDetailsForm
              value={toBdValue(editData)}
              onChange={(patch) => setEditData((prev) => ({ ...prev, ...fromBdPatch(patch) }))}
              eventTypes={eventTypes}
              mealTypes={mealTypes}
              serviceStyles={serviceStyles}
                productLines={activeProducts}
                showProduct={false}
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
                {/* The shared formatter, not a local `.toFixed(0)`: rounding to a
                    whole number printed "9%" on a quote charged at 8.875%. */}
                <span className="font-medium text-foreground">{formatPercent(taxRatePercent(q.tax_rate))}%</span>
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

      {/* Guests — entered once; every meal draws from this */}
      {editing && (
        <Card>
          <CardContent className="p-6">
            <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide mb-3">Guests</h2>
            <GuestCountField
              value={{ guest_count: editData.guest_count, segment_counts: editData.segment_counts, segment_prices: editData.segment_prices, big_eaters: editData.big_eaters, big_eaters_percentage: editData.big_eaters_percentage }}
              onChange={(patch) => setEditData((prev) => ({ ...prev, ...patch }))}
            />
            {hasVendorDoubleEntry(editData.segment_counts, editMeals, segmentMeta) && (
              <div role="alert" className="mt-2 flex items-start gap-2 rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-xs font-medium text-amber-800 dark:border-amber-700 dark:bg-amber-950/40 dark:text-amber-300">
                <span aria-hidden="true" className="text-sm leading-none">⚠️</span>
                <span>Possible double-count: you have <strong>vendor covers</strong> and a <strong>vendor-labelled meal</strong>. Vendors should be counted one way or the other, not both.</span>
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
            <MenuBuilder
              selectedDishIds={menuData.dish_ids}
              basedOnTemplate={menuData.based_on_template}
              guestCount={editGuestCount}
              onChange={setMenuData}
              onLoadCourses={(courses, dishCourses) => { setEditCourses(courses); setEditDishCourses(dishCourses); }}
              courses={editCourses}
              dishCourses={editDishCourses}
              menuChoices={editMenuChoices}
              guestsChoose={guestsChoose(editData.service_style, serviceStyles)}
              bigEaters={editData.big_eaters}
              bigEatersPercentage={editData.big_eaters_percentage}
              serviceStyleLabel={serviceStyleLabels[editData.service_style]}
              onStructureChange={({ courses, dishCourses, menuChoices }) => {
                setEditCourses(courses);
                setEditDishCourses(dishCourses);
                setEditMenuChoices(menuChoices);
              }}
              pricePerHead={editData.price_per_head}
              onPricePerHeadChange={(val) => setEditData((prev) => ({ ...prev, price_per_head: val }))}
              currencySymbol={cs}
              priceRoundingStep={Number(settings.price_rounding_step) || 50}
            />
          ) : null}
          {editing && (
            /* Per-segment rates sit beside the Price/head they derive from, not in
               the Guests card which is filled in before pricing (REL-428). */
            <SegmentRatesField
              segmentPrices={editData.segment_prices}
              onChange={(patch) => setEditData((prev) => ({ ...prev, ...patch }))}
              pricePerHead={editData.price_per_head}
              currencySymbol={cs}
            />
          )}
          {!editing && (
            <MenuBuilder
              selectedDishIds={q.dishes || []}
              basedOnTemplate={q.based_on_template || null}
              guestCount={q.guest_count}
              disabled
              courses={q.courses || []}
              dishCourses={q.dish_courses || {}}
              menuChoices={q.menu_choices || {}}
              guestsChoose={guestsChoose(q.service_style, serviceStyles)}
              serviceStyleLabel={serviceStyleLabels[q.service_style || ""]}
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
          defaultGuestCount={editData.guest_count}
          eventDate={editData.event_date}
          timeFormat={timeFormat}
          guestCount={editing ? editData.guest_count : q.guest_count}
          segmentCounts={editing ? editData.segment_counts : Object.fromEntries((q.guest_counts ?? []).map((r) => [r.segment, r.count]))}
          segmentMeta={segmentMeta}
        />
      )}

      {/* Timeline — below the meals: the run-of-show is built around the meal times,
          so it reads after you've said what's being served (REL-430).

          Rendered in READ-ONLY too (REL-447). This card used to be `{editing && …}`,
          so a saved quote showed no run-of-show at all — while the quote PDF printed
          the whole day for the customer. You couldn't check on screen what you'd
          just sent. Same component the event page uses. */}
      <Card>
        <CardContent className="p-6">
          <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide mb-3">Timeline</h2>
          {editing ? (
            <BookingTimelineField
              eventDate={editData.event_date}
              timeFormat={timeFormat}
              value={{ setup_time: editData.setup_time, guest_arrival_time: editData.guest_arrival_time, meal_time: editData.meal_time, end_time: editData.end_time }}
              onChange={(patch) => setEditData((prev) => ({ ...prev, ...patch }))}
              entries={editTimeline}
              onEntriesChange={setEditTimeline}
              presets={timelinePresets}
              meals={timelineMealRows(editMeals)}
            />
          ) : (
            <BookingTimelineView
              entries={q.timeline_entries}
              meals={timelineMealRows(q.additional_meals)}
              eventDate={q.event_date}
              setupTime={q.setup_time}
              guestArrivalTime={q.guest_arrival_time}
              mealTime={q.meal_time}
              endTime={q.end_time}
              dateFormat={dateFormat}
              timeFormat={timeFormat}
            />
          )}
        </CardContent>
      </Card>


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

      {/* Quote Total (menu + additional items).
          Editing: the engine's live answer for the current draft. Not editing:
          the engine's answer as saved. Either way the page prints figures it was
          given — while the first preview is still in flight, the saved ones stay
          up rather than the card going blank. */}
      {(() => {
        const saved = storedCardProps(q, cs) ?? legacyCardProps(q);
        const card = editing ? (preview ? previewCardProps(preview, cs) : saved) : saved;
        return (
      <>
      {warningBanner}
      <BookingTotalsCard
        title="Quote Total"
        currencySymbol={cs}
        {...card}
        foodLabel={`Food / Menu (${formatCurrency(editing ? editData.price_per_head : (q.price_per_head ?? 0), cs)}/head × ${editing ? editGuestCount : q.guest_count} guests)`}
        serviceChargePct={editing ? formatPercent(editData.service_charge_pct || "0") : formatPercent(q.service_charge_pct || "0")}
        serviceChargeControl={editing ? (
          <span className="flex items-center gap-1">
            Service charge
            <ValidatedInput type="number" step="0.01" min={0} max={100} className="w-16 h-7"
              value={editData.service_charge_pct} onBlur={repriceNow} onChange={setEdit("service_charge_pct")} />
            %
          </span>
        ) : undefined}
        gratuityPct={editing ? formatPercent(editData.gratuity_pct || "0") : formatPercent(q.gratuity_pct || "0")}
        gratuityControl={editing ? (
          <span className="flex items-center gap-1">
            Gratuity
            <ValidatedInput type="number" step="0.01" min={0} max={100} className="w-16 h-7"
              value={editData.gratuity_pct} onBlur={repriceNow} onChange={setEdit("gratuity_pct")} />
            %
          </span>
        ) : undefined}
        taxLabel={settings.tax_label}
        taxPercent={editing ? formatPercent(taxRatePercent(taxRateFraction(editData.tax_rate))) : formatPercent(taxRatePercent(q.tax_rate))}
        taxRateField={editing ? (
          <div>
            <label htmlFor="edit-tax-rate" className="block text-sm font-medium text-foreground mb-1">Tax Rate (%)</label>
            <ValidatedInput id="edit-tax-rate" type="number" step="0.001" min={0} max={100} value={editData.tax_rate}
              onBlur={repriceNow} onChange={setEdit("tax_rate")} />
          </div>
        ) : undefined}
        isStale={editing && previewStale}
        staleHint={editing ? staleHint : undefined}
      />
      </>
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

      {sendKind && quoteId && (
        <SendToClientModal
          open
          parent="quote"
          parentId={quoteId}
          kind={sendKind}
          subtitle={`Q-${q.id} · v${q.version} — ${q.contact_name || ""}${q.event_date ? `, ${formatDate(q.event_date, dateFormat)}` : ""}`}
          availability={messagingStatus}
          prefill={sendPrefill}
          onClose={() => { setSendKind(null); setSendPrefill(null); }}
          onSent={(_msg, note) => {
            setToast(note);
            mutateMessages();
            // A sign-link send moves a draft quote to sent, server-side.
            mutateQuote();
          }}
        />
      )}

      {/* Send results are transient, so they're a toast — banners are reserved
          for config states that persist. */}
      {toast && (
        <div
          role="status"
          className="fixed bottom-6 left-1/2 z-50 -translate-x-1/2 rounded-lg bg-foreground px-4 py-2 text-sm text-background shadow-lg"
        >
          {toast}
        </div>
      )}
    </div>
  );
}
