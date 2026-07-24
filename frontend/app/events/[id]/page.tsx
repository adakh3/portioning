"use client";

import { useEffect, useState, useCallback, useRef } from "react";
import { useParams, useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import {
  api,
  EventData,
  EventMealData,
  Contact,
} from "@/lib/api";
import {
  useEvent,
  useAccounts,
  useContacts,
  useLaborRoles,
  useStaff,
  useSiteSettings,
  useDateFormat,
  useEventTypes,
  useServiceStyles,
  useMealTypes,
  useUsers,
  useProductLines,
} from "@/lib/hooks";
import DealWonDialog from "@/components/DealWonDialog";
import EventPaymentsCard from "@/components/EventPaymentsCard";
import { useAuth } from "@/lib/auth";
import { formatDate, formatDateTime as sharedFormatDateTime, todayISO } from "@/lib/dateFormat";
import { LineItemInput, lineItemTotal, computeBookingTotals, buildEventSavePayload } from "@/lib/quoteTotals";
import BookingTotalsCard from "@/components/BookingTotalsCard";
import AddOnItemsEditor from "@/components/AddOnItemsEditor";
import MenuBuilder from "@/components/MenuBuilder";
import AdditionalMealsEditor from "@/components/AdditionalMealsEditor";
import GuestCountField, { GuestCountValue } from "@/components/GuestCountField";
import BookingTimelineField from "@/components/BookingTimelineField";
import BookingDetailsForm, { BookingDetailsValue } from "@/components/BookingDetailsForm";
import AssigneePicker from "@/components/AssigneePicker";
import { Button } from "@/components/ui/button";
import ESignPanel from "@/components/ESignPanel";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { ValidatedInput } from "@/components/ui/validated-input";
import { Textarea } from "@/components/ui/textarea";
import { formatCurrency } from "@/lib/utils";

const statusBadgeVariant: Record<string, "warning" | "info" | "secondary" | "success" | "destructive"> = {
  tentative: "warning",
  confirmed: "info",
  in_progress: "secondary",
  completed: "success",
  cancelled: "destructive",
};


function InfoRow({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div>
      <dt className="text-sm font-medium text-muted-foreground">{label}</dt>
      <dd className="text-sm text-foreground mt-0.5">{value || "\u2014"}</dd>
    </div>
  );
}

export default function EventDetailPage() {
  const params = useParams();
  const router = useRouter();
  const searchParams = useSearchParams();
  const isNew = params.id === "new";
  const startInEditMode = searchParams.get("edit") === "true";
  const eventId = isNew ? NaN : Number(params.id);

  // SWR hooks
  const { data: event, error: loadError, isLoading: eventLoading, mutate: mutateEvent } = useEvent(isNew || isNaN(eventId) ? null : eventId);
  const { data: accounts = [] } = useAccounts();
  const { data: orgContacts = [] } = useContacts();
  const { data: laborRoles = [] } = useLaborRoles();
  const { data: staffList = [] } = useStaff();
  const { data: users = [] } = useUsers();
  const { data: productLines = [] } = useProductLines();
  const activeProducts = productLines.filter((p) => p.is_active);
  const { user: currentUser } = useAuth();
  const salespeople = users.filter((u) => u.role === "salesperson");
  // Assignee options: salespeople, plus the current user if they aren't one (so an
  // admin creating the event can still see/keep themselves as the assignee).
  const assigneeOptions = currentUser && !salespeople.some((u) => u.id === currentUser.id)
    ? [{ id: currentUser.id, first_name: currentUser.first_name, last_name: currentUser.last_name }, ...salespeople]
    : salespeople;
  const { data: rawSettings } = useSiteSettings();
  const settings = rawSettings || { currency_symbol: "", currency_code: "", date_format: "MM/DD/YYYY", default_price_per_head: "0.00", target_food_cost_percentage: "30.00", price_rounding_step: "50", tax_label: "", default_tax_rate: "0.0000" };
  const dateFormat = useDateFormat();
  const timeFormat: "12h" | "24h" = ((rawSettings as { time_format?: string } | undefined)?.time_format === "12h") ? "12h" : "24h";
  const { data: eventTypesData = [] } = useEventTypes();
  const { data: serviceStylesData = [] } = useServiceStyles();
  const { data: mealTypesData = [] } = useMealTypes();
  const eventTypeLabels: Record<string, string> = Object.fromEntries(eventTypesData.map((et) => [et.value, et.label]));
  const serviceStyleLabels: Record<string, string> = Object.fromEntries(serviceStylesData.map((ss) => [ss.value, ss.label]));
  const mealTypeLabels: Record<string, string> = Object.fromEntries(mealTypesData.map((mt) => [mt.value, mt.label]));

  // Core state
  const loading = isNew ? false : eventLoading;
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [dealWon, setDealWon] = useState(false);
  const [editing, setEditing] = useState(isNew);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [formStatus, setFormStatus] = useState("tentative");
  // New-event assignee (existing events use the instant-save dropdown instead).
  const [formAssigned, setFormAssigned] = useState<number | null>(null);
  useEffect(() => {
    if (isNew && formAssigned === null && currentUser) setFormAssigned(currentUser.id);
  }, [isNew, currentUser, formAssigned]);

  // Menu state for create mode (no event ID to persist to yet)
  const [menuData, setMenuData] = useState<{
    dish_ids: number[];
    based_on_template: number | null;
  }>({ dish_ids: [], based_on_template: null });


  // Form fields (used in edit mode)
  const [formDate, setFormDate] = useState(isNew ? todayISO() : "");
  const [formAccount, setFormAccount] = useState<number | null>(null);
  const [formContact, setFormContact] = useState<number | null>(null);
  const [formIsB2b, setFormIsB2b] = useState(false);
  const [formVenue, setFormVenue] = useState<number | null>(null);
  const [formVenueAddress, setFormVenueAddress] = useState("");
  const [formEventType, setFormEventType] = useState("");
  const [formMealType, setFormMealType] = useState("");
  const [formBookingDate, setFormBookingDate] = useState("");
  const [formServiceStyle, setFormServiceStyle] = useState("");
  const [formProduct, setFormProduct] = useState<number | null>(null);
  // New direct events default to the org's first active product line.
  useEffect(() => {
    if (isNew && formProduct === null && activeProducts.length > 0) setFormProduct((activeProducts.find((p) => p.is_default) || activeProducts[0]).id);
  }, [isNew, formProduct, activeProducts]);
  const [formPricePerHead, setFormPricePerHead] = useState("");
  const [formNotes, setFormNotes] = useState("");
  // Adapter between the event's individual form* states (FKs as number|null) and
  // the shared BookingDetailsForm's string value. Gents/ladies stay out of it.
  const bookingValue: BookingDetailsValue = {
    contact: formContact != null ? String(formContact) : "",
    is_b2b: formIsB2b,
    account: formAccount != null ? String(formAccount) : "",
    venue: formVenue != null ? String(formVenue) : "",
    venue_address: formVenueAddress,
    event_type: formEventType,
    meal_type: formMealType,
    service_style: formServiceStyle,
    booking_date: formBookingDate,
    product: formProduct != null ? String(formProduct) : "",
    notes: formNotes,
  };
  const applyBookingPatch = (patch: Partial<BookingDetailsValue>) => {
    if (patch.product !== undefined) setFormProduct(patch.product ? Number(patch.product) : null);
    if (patch.contact !== undefined) setFormContact(patch.contact ? Number(patch.contact) : null);
    if (patch.is_b2b !== undefined) setFormIsB2b(patch.is_b2b);
    if (patch.account !== undefined) setFormAccount(patch.account ? Number(patch.account) : null);
    if (patch.venue !== undefined) setFormVenue(patch.venue ? Number(patch.venue) : null);
    if (patch.venue_address !== undefined) setFormVenueAddress(patch.venue_address);
    if (patch.event_type !== undefined) setFormEventType(patch.event_type);
    if (patch.meal_type !== undefined) setFormMealType(patch.meal_type);
    if (patch.service_style !== undefined) setFormServiceStyle(patch.service_style);
    if (patch.booking_date !== undefined) setFormBookingDate(patch.booking_date);
    if (patch.notes !== undefined) setFormNotes(patch.notes);
  };
  const [formKitchenInstructions, setFormKitchenInstructions] = useState("");
  const [formBanquetInstructions, setFormBanquetInstructions] = useState("");
  const [formSetupInstructions, setFormSetupInstructions] = useState("");

  // Guest form fields
  const [formGuestCount, setFormGuestCount] = useState(0);
  const [formCustomSplit, setFormCustomSplit] = useState(false);
  const [formGents, setFormGents] = useState(0);
  const [formLadies, setFormLadies] = useState(0);
  const [formGuaranteed, setFormGuaranteed] = useState<number | null>(null);
  const [formFinalCount, setFormFinalCount] = useState<number | null>(null);
  const [formFinalCountDue, setFormFinalCountDue] = useState("");
  const [formBigEaters, setFormBigEaters] = useState(false);
  const [formBigEatersPercent, setFormBigEatersPercent] = useState(0);
  const totalGuests = formGuestCount;
  // Adapter for the shared GuestCountField (canonical value = guest_count).
  const applyGuestPatch = (patch: Partial<GuestCountValue>) => {
    if (patch.guest_count !== undefined) setFormGuestCount(patch.guest_count);
    if (patch.gents !== undefined) setFormGents(patch.gents);
    if (patch.ladies !== undefined) setFormLadies(patch.ladies);
    if (patch.custom_split !== undefined) setFormCustomSplit(patch.custom_split);
    if (patch.big_eaters !== undefined) setFormBigEaters(patch.big_eaters);
    if (patch.big_eaters_percentage !== undefined) setFormBigEatersPercent(patch.big_eaters_percentage);
  };

  // Timeline form fields
  const [formSetupTime, setFormSetupTime] = useState("");
  const [formArrivalTime, setFormArrivalTime] = useState("");
  const [formMealTime, setFormMealTime] = useState("");
  const [formEndTime, setFormEndTime] = useState("");

  // Shift add form
  const [newShiftRole, setNewShiftRole] = useState<number | "">("");
  const [newShiftStaff, setNewShiftStaff] = useState<number | "">("");
  const [newShiftStart, setNewShiftStart] = useState("");
  const [newShiftEnd, setNewShiftEnd] = useState("");

  // Add-on line items (catalog-driven or ad-hoc)
  const [formLineItems, setFormLineItems] = useState<LineItemInput[]>([]);
  // Tax + service charge / gratuity (percent strings)
  const [formIsTaxable, setFormIsTaxable] = useState(false);
  const [formServiceChargePct, setFormServiceChargePct] = useState("0");
  const [formServiceChargeTaxable, setFormServiceChargeTaxable] = useState(true);
  const [formGratuityPct, setFormGratuityPct] = useState("0");
  // Additional meals
  const [formAdditionalMeals, setFormAdditionalMeals] = useState<EventMealData[]>([]);

  const syncFormToEvent = useCallback((data: EventData) => {
    setFormDate(data.date);
    setFormAccount(data.account);
    setFormContact(data.primary_contact);
    setFormIsB2b(data.is_b2b);
    setFormVenue(data.venue);
    setFormVenueAddress(data.venue_address || "");
    setFormEventType(data.event_type || "");
    setFormMealType(data.meal_type || "");
    setFormBookingDate(data.booking_date || "");
    setFormServiceStyle(data.service_style || "");
    setFormProduct(data.product ?? null);
    setFormPricePerHead(data.price_per_head || "");
    setFormNotes(data.notes || "");
    setFormKitchenInstructions(data.kitchen_instructions || "");
    setFormBanquetInstructions(data.banquet_instructions || "");
    setFormSetupInstructions(data.setup_instructions || "");
    setFormGuestCount(data.guest_count);
    setFormGents(data.gents);
    setFormLadies(data.ladies);
    // The split section opens only when a real split exists (it adds up).
    setFormCustomSplit((data.gents > 0 || data.ladies > 0) && data.gents + data.ladies === data.guest_count);
    setFormGuaranteed(data.guaranteed_count);
    setFormFinalCount(data.final_count);
    setFormFinalCountDue(data.final_count_due || "");
    setFormBigEaters(data.big_eaters);
    setFormBigEatersPercent(data.big_eaters_percentage);
    setFormSetupTime(data.setup_time ? data.setup_time.slice(0, 16) : "");
    setFormArrivalTime(data.guest_arrival_time ? data.guest_arrival_time.slice(0, 16) : "");
    setFormMealTime(data.meal_time ? data.meal_time.slice(0, 16) : "");
    setFormEndTime(data.end_time ? data.end_time.slice(0, 16) : "");
    setFormLineItems((data.line_items || []).map((li) => ({
      id: li.id, variant: li.variant, category: li.category, description: li.description,
      quantity: li.quantity, unit: li.unit, unit_price: li.unit_price,
      sort_order: li.sort_order ?? 0,
    })));
    setFormIsTaxable(data.is_taxable || false);
    setFormServiceChargePct(data.service_charge_pct ?? "0");
    setFormServiceChargeTaxable(data.service_charge_taxable ?? true);
    setFormGratuityPct(data.gratuity_pct ?? "0");
    setFormAdditionalMeals(data.additional_meals || []);
  }, []);

  useEffect(() => {
    if (event) {
      syncFormToEvent(event);
      if (startInEditMode) setEditing(true);
    }
  }, [event, syncFormToEvent, startInEditMode]);

  // Seed create-mode defaults from org settings, once, when settings first load:
  // price/head AND the pricing snapshot (service charge / gratuity). Without the
  // latter a new event would always POST 0% and lose the org's default service
  // charge — the backend snapshot only fills fields the payload omits.
  const createDefaultsApplied = useRef(false);
  useEffect(() => {
    if (!isNew || !rawSettings || createDefaultsApplied.current) return;
    if (parseFloat(rawSettings.default_price_per_head) > 0) setFormPricePerHead(rawSettings.default_price_per_head);
    setFormServiceChargePct(String(rawSettings.service_charge_default_pct ?? "0"));
    setFormServiceChargeTaxable(rawSettings.service_charge_taxable_default ?? true);
    setFormGratuityPct(String(rawSettings.gratuity_default_pct ?? "0"));
    createDefaultsApplied.current = true;
  }, [isNew, rawSettings]);

  useEffect(() => {
    if (loadError) setError(loadError instanceof Error ? loadError.message : "Failed to load event");
  }, [loadError]);

  const handleSaveAll = async () => {
    if (!isNew && !event) return;
    if (!formDate) {
      setError("Event date is required");
      return;
    }
    if (!formContact) {
      setError("Customer is required");
      return;
    }
    if (formIsB2b && !formAccount) {
      setError("A business is required for a B2B event");
      return;
    }
    if (formCustomSplit && formGents + formLadies !== formGuestCount) {
      setError(`Gents + ladies must add up to the guest count (${formGuestCount})`);
      return;
    }
    setSaving(true);
    const customerName = orgContacts.find((c) => c.id === formContact)?.name
      || accounts.find((a) => a.id === formAccount)?.name || "Event";
    const payload = buildEventSavePayload({
      name: `${customerName} — ${formDate}`,
      date: formDate,
      is_b2b: formIsB2b,
      account: formAccount,
      primary_contact: formContact,
      venue: formVenue,
      venue_address: formVenueAddress,
      event_type: formEventType,
      meal_type: formMealType,
      booking_date: formBookingDate,
      service_style: formServiceStyle,
      product: formProduct,
      price_per_head: formPricePerHead || null,
      notes: formNotes,
      kitchen_instructions: formKitchenInstructions,
      banquet_instructions: formBanquetInstructions,
      setup_instructions: formSetupInstructions,
      guest_count: formGuestCount,
      gents: formCustomSplit ? formGents : 0,
      ladies: formCustomSplit ? formLadies : 0,
      guaranteed_count: formGuaranteed,
      final_count: formFinalCount,
      final_count_due: formFinalCountDue,
      big_eaters: formBigEaters,
      big_eaters_percentage: formBigEatersPercent,
      setup_time: formSetupTime,
      guest_arrival_time: formArrivalTime,
      meal_time: formMealTime,
      end_time: formEndTime,
      is_taxable: formIsTaxable,
      service_charge_pct: formServiceChargePct || "0",
      service_charge_taxable: formServiceChargeTaxable,
      gratuity_pct: formGratuityPct || "0",
      dish_ids: menuData.dish_ids,
      based_on_template: menuData.based_on_template,
      line_items: formLineItems,
      meals: formAdditionalMeals,
    });
    try {
      if (isNew) {
        const created = await api.createEvent({ ...payload, status: formStatus, assigned_to: formAssigned });
        router.push(`/events/${created.id}`);
      } else {
        await api.updateEvent(event!.id, payload);
        await mutateEvent();
        setEditing(false);
      }
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Save failed");
    } finally {
      setSaving(false);
    }
  };

  const handleCancelEdit = () => {
    if (isNew) {
      router.push("/events");
      return;
    }
    if (event) syncFormToEvent(event);
    setEditing(false);
  };

  const handleAssign = async (value: string) => {
    if (!event) return;
    setSaving(true);
    try {
      await api.updateEvent(event.id, { assigned_to: value ? Number(value) : null } as Partial<EventData>);
      await mutateEvent();
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Reassign failed");
    } finally {
      setSaving(false);
    }
  };

  const handleProductChange = async (value: string) => {
    const pid = value ? Number(value) : null;
    setFormProduct(pid);
    if (!event) return; // new event: saved on create
    setSaving(true);
    try {
      await api.updateEvent(event.id, { product: pid } as Partial<EventData>);
      await mutateEvent();
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Failed to set product");
    } finally {
      setSaving(false);
    }
  };

  const handleStatusTransition = async (newStatus: string) => {
    if (!event) return;
    setSaving(true);
    try {
      await api.updateEvent(event.id, { status: newStatus } as Partial<EventData>);
      await mutateEvent();
      if (newStatus === "confirmed") setDealWon(true);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Status change failed");
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async () => {
    if (!event) return;
    setSaving(true);
    try {
      await api.deleteEvent(event.id);
      router.push("/events");
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Delete failed");
      setSaving(false);
    }
  };

  const handleMenuSave = async (data: { dish_ids: number[]; based_on_template: number | null }) => {
    if (!event) return;
    setSaving(true);
    try {
      await api.updateEvent(event.id, {
        dish_ids: data.dish_ids,
        based_on_template: data.based_on_template,
      });
      await mutateEvent();
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Save failed");
    } finally {
      setSaving(false);
    }
  };

  const handleAddShift = async () => {
    if (!event || newShiftRole === "" || !newShiftStart || !newShiftEnd) return;
    setSaving(true);
    try {
      await api.createShift({
        event: event.id,
        role: newShiftRole as number,
        staff_member: newShiftStaff === "" ? null : (newShiftStaff as number),
        start_time: newShiftStart,
        end_time: newShiftEnd,
      });
      setNewShiftRole("");
      setNewShiftStaff("");
      setNewShiftStart("");
      setNewShiftEnd("");
      await mutateEvent();
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Failed to add shift");
    } finally {
      setSaving(false);
    }
  };

  const handleDeleteShift = async (id: number) => {
    setSaving(true);
    try {
      await api.deleteShift(id);
      await mutateEvent();
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Failed to delete shift");
    } finally {
      setSaving(false);
    }
  };


  const handleCreateInvoice = async () => {
    if (!event) return;
    setSaving(true);
    const today = new Date();
    const dueDate = new Date(today);
    dueDate.setDate(dueDate.getDate() + 30);
    try {
      await api.createInvoice({
        event: event.id,
        invoice_number: `INV-${Date.now()}`,
        invoice_type: "deposit",
        issue_date: today.toISOString().split("T")[0],
        due_date: dueDate.toISOString().split("T")[0],
        subtotal: event.subtotal,
        tax_rate: event.tax_rate,
        tax_amount: event.tax_amount,
        total: event.total,
      });
      await mutateEvent();
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Failed to create invoice");
    } finally {
      setSaving(false);
    }
  };

  // Contacts for selected account

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20">
        <p className="text-muted-foreground">Loading event...</p>
      </div>
    );
  }

  if (!isNew && !event) {
    return (
      <div className="flex items-center justify-center py-20">
        <p className="text-destructive">{error || "Event not found"}</p>
      </div>
    );
  }

  const totalLaborCost = event?.shifts.reduce(
    (sum, s) => sum + parseFloat(s.shift_cost || "0"),
    0
  ) ?? 0;


  const formatDateTime = (dt: string | null) => {
    if (!dt) return "\u2014";
    return sharedFormatDateTime(dt, dateFormat, timeFormat);
  };

  return (
    <div className="space-y-6">
      <Button variant="outline" size="sm" asChild>
        <Link href="/events">&larr; Back to Events</Link>
      </Button>
      {/* Error banner */}
      {error && (
        <div className="bg-destructive/10 border border-destructive/20 rounded-lg p-4 flex items-center justify-between">
          <p className="text-destructive text-sm">{error}</p>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => setError(null)}
            className="text-destructive/60 hover:text-destructive"
          >
            Dismiss
          </Button>
        </div>
      )}

      {/* Header Section */}
      <Card>
        <CardContent className="p-6">
          <div className="flex items-start justify-between gap-4">
            <div className="flex items-end gap-3 flex-1 min-w-0">
              <h1 className="text-2xl font-bold text-foreground truncate self-center">
                {isNew
                  ? (formAccount ? `${accounts.find((a) => a.id === formAccount)?.name || "New Event"}` : "New Event")
                  : event!.name}
              </h1>
              <div className="flex flex-col gap-1">
                <label className="text-xs font-medium text-muted-foreground">Status</label>
                {isNew ? (
                  <select
                    value={formStatus}
                    onChange={(e) => setFormStatus(e.target.value)}
                    className="flex h-9 rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                  >
                    <option value="tentative">Tentative</option>
                    <option value="confirmed">Confirmed</option>
                  </select>
                ) : (
                  <span className="h-9 flex items-center">
                    <Badge variant={statusBadgeVariant[event!.status] || "secondary"} className="whitespace-nowrap">
                      {event!.status_display || event!.status}
                    </Badge>
                  </span>
                )}
              </div>
              {isNew ? (
                <AssigneePicker value={formAssigned} options={assigneeOptions} onChange={setFormAssigned} />
              ) : (
                <AssigneePicker
                  value={event!.assigned_to}
                  currentName={event!.assigned_to_name}
                  disabled={saving}
                  onChange={(pid) => handleAssign(pid ? String(pid) : "")}
                  options={(() => {
                    // Always include the current assignee, even if not a salesperson
                    // (e.g. an admin who created the event), so it's clear who owns it.
                    const opts = [...salespeople];
                    if (event!.assigned_to && !opts.some((u) => u.id === event!.assigned_to)) {
                      opts.unshift({ id: event!.assigned_to, first_name: event!.assigned_to_name || "Assigned", last_name: "", role: "" } as (typeof salespeople)[number]);
                    }
                    return opts;
                  })()}
                />
              )}
              {activeProducts.length > 0 && (
                <div className="flex flex-col gap-1">
                  <label className="text-xs font-medium text-muted-foreground">Product</label>
                  <select
                    value={formProduct != null ? String(formProduct) : ""}
                    onChange={(e) => handleProductChange(e.target.value)}
                    disabled={saving}
                    title="Product line for this event"
                    aria-label="Product line"
                    className="flex h-9 rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                  >
                    {activeProducts.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
                  </select>
                </div>
              )}
            </div>
            <div className="flex gap-2 flex-shrink-0">
              {editing ? null : (
                <>
                  <Button
                    size="sm"
                    onClick={() => setEditing(true)}
                  >
                    Edit
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={async () => {
                      try {
                        const blob = await api.downloadEventPDF(event!.id);
                        const url = URL.createObjectURL(blob);
                        const a = document.createElement("a");
                        a.href = url;
                        a.download = `Event-${event!.id}.pdf`;
                        a.click();
                        URL.revokeObjectURL(url);
                      } catch (err) {
                        setError(err instanceof Error ? err.message : "Failed to download PDF");
                      }
                    }}
                  >
                    Download PDF
                  </Button>
                  {/* Status transitions */}
                  {event!.status === "tentative" && (
                    <Button
                      variant="success"
                      size="sm"
                      onClick={() => handleStatusTransition("confirmed")}
                      disabled={saving}
                    >
                      Confirm
                    </Button>
                  )}
                  {event!.status === "confirmed" && (
                    <Button
                      variant="warning"
                      size="sm"
                      onClick={() => handleStatusTransition("in_progress")}
                      disabled={saving}
                    >
                      Start
                    </Button>
                  )}
                  {event!.status === "in_progress" && (
                    <Button
                      variant="success"
                      size="sm"
                      onClick={() => handleStatusTransition("completed")}
                      disabled={saving}
                    >
                      Complete
                    </Button>
                  )}
                  {event!.status === "cancelled" && (
                    <Button
                      variant="warning"
                      size="sm"
                      onClick={() => handleStatusTransition("tentative")}
                      disabled={saving}
                    >
                      Reactivate
                    </Button>
                  )}
                  {(event!.status === "tentative" ||
                    event!.status === "confirmed" ||
                    event!.status === "in_progress") && (
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => handleStatusTransition("cancelled")}
                      disabled={saving}
                    >
                      Archive
                    </Button>
                  )}
                  {/* A signed booking can't be hard-deleted (it would destroy the
                      client's signature) — Archive/Cancel it instead. */}
                  {!event!.signature && (
                    <Button
                      variant="destructive"
                      size="sm"
                      onClick={() => { setError(null); setShowDeleteConfirm(true); }}
                    >
                      Delete
                    </Button>
                  )}
                  {event!.source_quote_id && (
                    <Button variant="link" size="sm" asChild>
                      <Link href={`/quotes/${event!.source_quote_id}`}>
                        View Quote &rarr;
                      </Link>
                    </Button>
                  )}
                </>
              )}
            </div>
          </div>
          {/* Client e-signature — for a booking created directly as an event */}
          {event && (event.signature || event.status === "tentative") && (
            <ESignPanel kind="event" id={event.id} publicToken={event.public_token} signature={event.signature} contactPhone={event.contact_phone} contactName={event.contact_name} subject={event.event_type} />
          )}
        </CardContent>
      </Card>

      {/* Delete confirmation */}
      {!isNew && showDeleteConfirm && (
        <div className="bg-destructive/10 border border-destructive/20 rounded-lg p-4 flex items-center justify-between">
          <p className="text-destructive text-sm">
            Are you sure you want to delete this event? This cannot be undone.
          </p>
          <div className="flex gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={() => setShowDeleteConfirm(false)}
            >
              No, keep it
            </Button>
            <Button
              variant="destructive"
              size="sm"
              onClick={handleDelete}
              disabled={saving}
            >
              {saving ? "Deleting..." : "Yes, delete"}
            </Button>
          </div>
        </div>
      )}

      {/* Customer & Venue Section */}
      <Card>
        <CardContent className="p-6">
          <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide mb-3">Event Details</h2>
            {editing ? (
              <BookingDetailsForm
                value={bookingValue}
                onChange={applyBookingPatch}
                eventTypes={eventTypesData}
                mealTypes={mealTypesData}
                serviceStyles={serviceStylesData}
                productLines={activeProducts}
                showProduct={false}
                customerAddress={orgContacts.find((c) => c.id === formContact)?.address}
                showNotes
                eventDateSlot={
                  <div>
                    <label className="block text-sm font-medium text-foreground mb-1">Date *</label>
                    <ValidatedInput type="date" value={formDate} onChange={(e) => setFormDate(e.target.value)} required />
                  </div>
                }
              />
            ) : (
              <dl className="grid grid-cols-2 md:grid-cols-3 gap-4">
                <InfoRow label="Date" value={event!.date} />
                <InfoRow label="Customer" value={event!.contact_name} />
                {event!.is_b2b && <InfoRow label="Business" value={event!.account_name} />}
                <InfoRow label="Venue" value={event!.venue_name || event!.venue_address || null} />
                <InfoRow label="Event Type" value={eventTypeLabels[event!.event_type] || event!.event_type} />
                <InfoRow label="Meal Type" value={mealTypeLabels[event!.meal_type] || event!.meal_type || null} />
                <InfoRow label="Service Style" value={serviceStyleLabels[event!.service_style] || event!.service_style} />
                <InfoRow label="Booking Date" value={event!.booking_date ? formatDate(event!.booking_date, dateFormat) : null} />
                {event!.notes && <div className="col-span-full"><InfoRow label="Notes" value={event!.notes} /></div>}
              </dl>
            )}
        </CardContent>
      </Card>

      {/* Timeline Section */}
      <Card>
        <CardContent className="p-6">
          <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide mb-3">Timeline</h2>
            {editing ? (
              <BookingTimelineField
                eventDate={formDate}
                timeFormat={timeFormat}
                value={{ setup_time: formSetupTime, guest_arrival_time: formArrivalTime, meal_time: formMealTime, end_time: formEndTime }}
                onChange={(patch) => {
                  if (patch.setup_time !== undefined) setFormSetupTime(patch.setup_time);
                  if (patch.guest_arrival_time !== undefined) setFormArrivalTime(patch.guest_arrival_time);
                  if (patch.meal_time !== undefined) setFormMealTime(patch.meal_time);
                  if (patch.end_time !== undefined) setFormEndTime(patch.end_time);
                }}
              />
            ) : (
              <dl className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <InfoRow label="Setup Time" value={formatDateTime(event!.setup_time)} />
                <InfoRow label="Guest Arrival" value={formatDateTime(event!.guest_arrival_time)} />
                <InfoRow label="Meal Time" value={formatDateTime(event!.meal_time)} />
                <InfoRow label="End Time" value={formatDateTime(event!.end_time)} />
              </dl>
            )}
        </CardContent>
      </Card>

      {/* Main Meal Section */}
      <Card>
        <CardContent className="p-6">
          <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide mb-3">Main Meal</h2>
            {editing ? (
              <div className="space-y-4">
                <GuestCountField
                  value={{ guest_count: formGuestCount, gents: formGents, ladies: formLadies, custom_split: formCustomSplit, big_eaters: formBigEaters, big_eaters_percentage: formBigEatersPercent }}
                  onChange={applyGuestPatch}
                />
                <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
                  <div>
                    <label className="block text-sm font-medium text-foreground mb-1">Guaranteed Count</label>
                    <ValidatedInput
                      type="number"
                      min={0}
                      max={100000}
                      value={formGuaranteed ?? ""}
                      onChange={(e) => setFormGuaranteed(e.target.value ? Number(e.target.value) : null)}
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-foreground mb-1">Final Count</label>
                    <ValidatedInput
                      type="number"
                      min={0}
                      max={100000}
                      value={formFinalCount ?? ""}
                      onChange={(e) => setFormFinalCount(e.target.value ? Number(e.target.value) : null)}
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-foreground mb-1">Final Count Due</label>
                    <ValidatedInput
                      type="date"
                      value={formFinalCountDue}
                      onChange={(e) => setFormFinalCountDue(e.target.value)}
                    />
                  </div>
                </div>
                <div className="border-t border-border pt-4">
                  {isNew ? (
                    <MenuBuilder
                      selectedDishIds={menuData.dish_ids}
                      basedOnTemplate={menuData.based_on_template}
                      onChange={setMenuData}
                      pricePerHead={formPricePerHead}
                      onPricePerHeadChange={setFormPricePerHead}
                      guestCount={totalGuests}
                      currencySymbol={settings.currency_symbol}
                    />
                  ) : (
                    <MenuBuilder
                      selectedDishIds={event!.dishes}
                      basedOnTemplate={event!.based_on_template}
                      onSave={handleMenuSave}
                      pricePerHead={formPricePerHead}
                      onPricePerHeadChange={setFormPricePerHead}
                      guestCount={totalGuests}
                      currencySymbol={settings.currency_symbol}
                      disabled={false}
                    />
                  )}
                </div>
              </div>
            ) : (
              <div className="space-y-4">
                <dl className="grid grid-cols-2 md:grid-cols-3 gap-4">
                  <InfoRow label="Guest Count" value={event!.guest_count} />
                  {(event!.gents > 0 || event!.ladies > 0) && <InfoRow label="Gents" value={event!.gents} />}
                  {(event!.gents > 0 || event!.ladies > 0) && <InfoRow label="Ladies" value={event!.ladies} />}
                  {event!.big_eaters && <InfoRow label="Hearty eaters" value={`+${event!.big_eaters_percentage}%`} />}
                  {event!.guaranteed_count != null && <InfoRow label="Guaranteed Count" value={event!.guaranteed_count} />}
                  {event!.final_count != null && <InfoRow label="Final Count" value={event!.final_count} />}
                  {event!.final_count_due && <InfoRow label="Final Count Due" value={formatDate(event!.final_count_due, dateFormat)} />}
                </dl>
                <div className="border-t border-border pt-4">
                  {event!.dishes.length === 0 ? (
                    <p className="text-sm text-muted-foreground">No menu selected.</p>
                  ) : (
                    <MenuBuilder
                      selectedDishIds={event!.dishes}
                      basedOnTemplate={event!.based_on_template}
                      onSave={handleMenuSave}
                      pricePerHead={formPricePerHead}
                      onPricePerHeadChange={undefined}
                      guestCount={event!.guest_count}
                      currencySymbol={settings.currency_symbol}
                      disabled={true}
                    />
                  )}
                </div>
              </div>
            )}
        </CardContent>
      </Card>

      {/* Additional Meals Section */}
      <AdditionalMealsEditor
        meals={formAdditionalMeals}
        onChange={setFormAdditionalMeals}
        editing={editing}
        currencySymbol={settings.currency_symbol}
        dateFormat={dateFormat}
        defaultGuestCount={totalGuests}
        eventDate={formDate}
        timeFormat={timeFormat}
      />

      {/* Add-on items (arrangements, beverages, rentals, custom) */}
      <Card>
        <CardContent className="p-6">
          <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide mb-3">Add-on items</h2>
          {editing ? (
            <AddOnItemsEditor
              items={formLineItems}
              onChange={setFormLineItems}
              guestCount={totalGuests}
              currencySymbol={settings.currency_symbol}
            />
          ) : (event!.line_items?.length ?? 0) > 0 ? (
            <div className="space-y-1.5">
              {event!.line_items.map((li) => (
                <div key={li.id} className="flex items-baseline gap-2">
                  <span className="text-sm text-foreground font-medium">{li.description}</span>
                  <span className="text-sm text-muted-foreground">
                    \u00d7{li.quantity}
                    {parseFloat(li.unit_price) > 0 && ` @ ${formatCurrency(li.unit_price, settings.currency_symbol)}`}
                  </span>
                  <span className="ml-auto text-sm text-foreground">{formatCurrency(li.line_total, settings.currency_symbol)}</span>
                </div>
              ))}
            </div>
          ) : (
            <p className="text-sm text-muted-foreground">No add-on items.</p>
          )}
        </CardContent>
      </Card>

      {/* Pricing Section — shared BookingTotalsCard + engine (same as quotes) */}
      {(() => {
        const pph = editing ? parseFloat(formPricePerHead) || 0 : parseFloat(event?.price_per_head || "0");
        const guests = editing ? totalGuests : (event?.guest_count || 0);
        const foodTotal = pph * guests;
        const meals = editing ? formAdditionalMeals : (event?.additional_meals || []);
        const mealsTotal = meals.reduce((sum, m) => sum + m.guest_count * (parseFloat(m.price_per_head || "0") || 0), 0);
        const mealRows = meals
          .map((m) => ({ m, total: m.guest_count * (parseFloat(m.price_per_head || "0") || 0) }))
          .filter((r) => r.total > 0 || (parseFloat(r.m.price_per_head || "0") || 0) > 0)
          .map((r) => ({
            label: `${r.m.label || "Additional Meal"} (${formatCurrency(r.m.price_per_head || "0", settings.currency_symbol)}/head × ${r.m.guest_count})`,
            total: r.total,
          }));
        const liItems = editing ? formLineItems : (event?.line_items || []);
        const addOnsTotal = liItems.reduce((sum, li) => sum + lineItemTotal(li, guests), 0);
        const taxable = editing ? formIsTaxable : (event?.is_taxable || false);
        const taxRate = parseFloat(event?.tax_rate || settings.default_tax_rate) || 0;
        // One engine, same rule as quotes (tax on food + meals + taxable add-ons
        // only). Editing → live preview; viewing → the server's stored totals.
        const computed = computeBookingTotals(
          foodTotal + mealsTotal, liItems, guests, taxable ? taxRate : 0,
          parseFloat(formServiceChargePct || "0"), formServiceChargeTaxable,
          parseFloat(formGratuityPct || "0"),
        );
        const subtotal = editing ? computed.subtotal : parseFloat(event?.subtotal || "0");
        const taxAmount = editing ? computed.tax_amount : parseFloat(event?.tax_amount || "0");
        const grandTotal = editing ? computed.total : parseFloat(event?.total || "0");
        const serviceCharge = editing ? computed.service_charge : parseFloat(event?.service_charge || "0");
        const gratuity = editing ? computed.gratuity : parseFloat(event?.gratuity || "0");

        return (
          <BookingTotalsCard
            title="Pricing"
            currencySymbol={settings.currency_symbol}
            foodTotal={foodTotal}
            foodLabel={`Food (${formatCurrency(pph, settings.currency_symbol)}/head × ${guests} guests)`}
            meals={mealRows}
            addOnsTotal={addOnsTotal}
            subtotal={subtotal}
            serviceCharge={serviceCharge}
            serviceChargePct={editing ? parseFloat(formServiceChargePct || "0").toFixed(0) : parseFloat(event?.service_charge_pct || "0").toFixed(0)}
            serviceChargeControl={editing ? (
              <span className="flex items-center gap-1">
                Service charge
                <input type="number" step="0.01" min={0} max={100}
                  className="w-16 h-7 rounded-md border border-input bg-transparent px-2 text-sm"
                  value={formServiceChargePct}
                  onChange={(e) => setFormServiceChargePct(e.target.value)} />
                %
              </span>
            ) : undefined}
            taxAmount={taxAmount}
            gratuity={gratuity}
            gratuityPct={editing ? parseFloat(formGratuityPct || "0").toFixed(0) : parseFloat(event?.gratuity_pct || "0").toFixed(0)}
            gratuityControl={editing ? (
              <span className="flex items-center gap-1">
                Gratuity
                <input type="number" step="0.01" min={0} max={100}
                  className="w-16 h-7 rounded-md border border-input bg-transparent px-2 text-sm"
                  value={formGratuityPct}
                  onChange={(e) => setFormGratuityPct(e.target.value)} />
                %
              </span>
            ) : undefined}
            total={grandTotal}
            taxLabel={settings.tax_label}
            taxPercent={(taxRate * 100).toFixed(0)}
            taxApplied={taxable}
            taxControl={editing ? (
              <label className="flex items-center gap-2 cursor-pointer">
                <input
                  type="checkbox"
                  checked={formIsTaxable}
                  onChange={(e) => setFormIsTaxable(e.target.checked)}
                  className="rounded border-input"
                />
                {settings.tax_label} ({(taxRate * 100).toFixed(0)}%)
              </label>
            ) : undefined}
          />
        );
      })()}

      {/* Staffing and Invoices sections hidden from salesperson view (REL-289) */}
      {/* These remain accessible via /staff and /invoices pages */}

      {/* Client payments (advances / part / full) — recorded against this booking */}
      {!isNew && event && !editing && (
        <EventPaymentsCard
          event={event}
          users={users}
          currencySymbol={settings.currency_symbol}
          dateFormat={dateFormat}
          currentUserId={currentUser?.id ?? null}
          onChange={() => mutateEvent()}
        />
      )}

      {/* Instructions Section */}
      <Card>
        <CardContent className="p-6">
          <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide mb-3">Instructions</h2>
          {editing ? (
            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-foreground mb-1">Kitchen Instructions</label>
                <Textarea
                  value={formKitchenInstructions}
                  onChange={(e) => setFormKitchenInstructions(e.target.value)}
                  rows={3}
                  maxLength={5000}
                  placeholder="Cooking-specific notes for the kitchen team..."
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-foreground mb-1">Banquet Instructions</label>
                <Textarea
                  value={formBanquetInstructions}
                  onChange={(e) => setFormBanquetInstructions(e.target.value)}
                  rows={3}
                  maxLength={5000}
                  placeholder="Front-of-house / service team notes..."
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-foreground mb-1">Setup / Arrangements Instructions</label>
                <Textarea
                  value={formSetupInstructions}
                  onChange={(e) => setFormSetupInstructions(e.target.value)}
                  rows={3}
                  maxLength={5000}
                  placeholder="Logistics, table layout, client-provided items..."
                />
              </div>
            </div>
          ) : !isNew && (
            <dl className="space-y-3">
              <div>
                <dt className="text-sm font-medium text-muted-foreground">Kitchen</dt>
                <dd className="text-sm text-foreground mt-0.5 whitespace-pre-wrap">{event!.kitchen_instructions || "\u2014"}</dd>
              </div>
              <div>
                <dt className="text-sm font-medium text-muted-foreground">Banquet</dt>
                <dd className="text-sm text-foreground mt-0.5 whitespace-pre-wrap">{event!.banquet_instructions || "\u2014"}</dd>
              </div>
              <div>
                <dt className="text-sm font-medium text-muted-foreground">Setup / Arrangements</dt>
                <dd className="text-sm text-foreground mt-0.5 whitespace-pre-wrap">{event!.setup_instructions || "\u2014"}</dd>
              </div>
            </dl>
          )}
        </CardContent>
      </Card>

      {/* Bottom action bar for create/edit mode */}
      {editing && (
        <div className="sticky bottom-4 flex justify-end gap-3 z-10">
          <Button variant="outline" onClick={handleCancelEdit}>
            Discard
          </Button>
          <Button onClick={handleSaveAll} disabled={saving}>
            {saving ? (isNew ? "Creating..." : "Saving...") : (isNew ? "Create Event" : "Save")}
          </Button>
        </div>
      )}

      {!isNew && event && (
        <DealWonDialog
          open={dealWon}
          onClose={() => setDealWon(false)}
          eventName={event.name}
          repName={event.assigned_to_name}
          revenue={event.total}
          currencySymbol={settings.currency_symbol}
        />
      )}
    </div>
  );
}
