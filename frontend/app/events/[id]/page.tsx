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
} from "@/lib/hooks";
import DealWonDialog from "@/components/DealWonDialog";
import { formatDate, formatDateTime as sharedFormatDateTime } from "@/lib/dateFormat";
import { LineItemInput, lineItemTotal, computeBookingTotals, buildEventSavePayload } from "@/lib/quoteTotals";
import BookingTotalsCard from "@/components/BookingTotalsCard";
import AddOnItemsEditor from "@/components/AddOnItemsEditor";
import MenuBuilder from "@/components/MenuBuilder";
import AdditionalMealsEditor from "@/components/AdditionalMealsEditor";
import GuestCountField, { GuestCountValue } from "@/components/GuestCountField";
import BookingDetailsForm, { BookingDetailsValue } from "@/components/BookingDetailsForm";
import { Button } from "@/components/ui/button";
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
  const salespeople = users.filter((u) => u.role === "salesperson");
  const { data: rawSettings } = useSiteSettings();
  const settings = rawSettings || { currency_symbol: "\u00A3", currency_code: "GBP", date_format: "DD/MM/YYYY", default_price_per_head: "0.00", target_food_cost_percentage: "30.00", price_rounding_step: "50", tax_label: "VAT", default_tax_rate: "0.2000" };
  const dateFormat = useDateFormat();
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

  // Menu state for create mode (no event ID to persist to yet)
  const [menuData, setMenuData] = useState<{
    dish_ids: number[];
    based_on_template: number | null;
  }>({ dish_ids: [], based_on_template: null });


  // Form fields (used in edit mode)
  const [formDate, setFormDate] = useState("");
  const [formAccount, setFormAccount] = useState<number | null>(null);
  const [formContact, setFormContact] = useState<number | null>(null);
  const [formIsB2b, setFormIsB2b] = useState(false);
  const [formVenue, setFormVenue] = useState<number | null>(null);
  const [formVenueAddress, setFormVenueAddress] = useState("");
  const [formEventType, setFormEventType] = useState("");
  const [formMealType, setFormMealType] = useState("");
  const [formBookingDate, setFormBookingDate] = useState("");
  const [formServiceStyle, setFormServiceStyle] = useState("");
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
    notes: formNotes,
  };
  const applyBookingPatch = (patch: Partial<BookingDetailsValue>) => {
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
  const [formCustomSplit, setFormCustomSplit] = useState(false);
  const [formGents, setFormGents] = useState(0);
  const [formLadies, setFormLadies] = useState(0);
  const [formGuaranteed, setFormGuaranteed] = useState<number | null>(null);
  const [formFinalCount, setFormFinalCount] = useState<number | null>(null);
  const [formFinalCountDue, setFormFinalCountDue] = useState("");
  const [formBigEaters, setFormBigEaters] = useState(false);
  const [formBigEatersPercent, setFormBigEatersPercent] = useState(0);
  const totalGuests = formGents + formLadies;
  // Adapter for the shared GuestCountField (canonical value = gents/ladies).
  const applyGuestPatch = (patch: Partial<GuestCountValue>) => {
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
  // Tax
  const [formIsTaxable, setFormIsTaxable] = useState(false);
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
    setFormPricePerHead(data.price_per_head || "");
    setFormNotes(data.notes || "");
    setFormKitchenInstructions(data.kitchen_instructions || "");
    setFormBanquetInstructions(data.banquet_instructions || "");
    setFormSetupInstructions(data.setup_instructions || "");
    const total = data.gents + data.ladies;
    setFormGents(data.gents);
    setFormLadies(data.ladies);
    const is5050 = total === 0 || (data.gents === Math.ceil(total / 2) && data.ladies === Math.floor(total / 2));
    setFormCustomSplit(!is5050);
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
    setFormAdditionalMeals(data.additional_meals || []);
  }, []);

  useEffect(() => {
    if (event) {
      syncFormToEvent(event);
      if (startInEditMode) setEditing(true);
    }
  }, [event, syncFormToEvent, startInEditMode]);

  // Set default price from settings in create mode
  const defaultPriceApplied = useRef(false);
  useEffect(() => {
    if (isNew && rawSettings && parseFloat(rawSettings.default_price_per_head) > 0 && !defaultPriceApplied.current) {
      setFormPricePerHead(rawSettings.default_price_per_head);
      defaultPriceApplied.current = true;
    }
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
      price_per_head: formPricePerHead || null,
      notes: formNotes,
      kitchen_instructions: formKitchenInstructions,
      banquet_instructions: formBanquetInstructions,
      setup_instructions: formSetupInstructions,
      gents: formGents,
      ladies: formLadies,
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
      dish_ids: menuData.dish_ids,
      based_on_template: menuData.based_on_template,
      line_items: formLineItems,
      meals: formAdditionalMeals,
    });
    try {
      if (isNew) {
        const created = await api.createEvent({ ...payload, status: formStatus });
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
    return sharedFormatDateTime(dt, dateFormat);
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
            <div className="flex items-center gap-3 flex-1 min-w-0">
              <h1 className="text-2xl font-bold text-foreground truncate">
                {isNew
                  ? (formAccount ? `${accounts.find((a) => a.id === formAccount)?.name || "New Event"}` : "New Event")
                  : event!.name}
              </h1>
              {editing ? (
                <ValidatedInput
                  type="date"
                  value={formDate}
                  onChange={(e) => setFormDate(e.target.value)}
                  className="w-auto"
                />
              ) : (
                <span className="text-muted-foreground text-sm whitespace-nowrap">{event!.date}</span>
              )}
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
                <Badge variant={statusBadgeVariant[event!.status] || "secondary"} className="whitespace-nowrap">
                  {event!.status_display || event!.status}
                </Badge>
              )}
              {!isNew && (
                <select
                  value={event!.assigned_to ?? ""}
                  disabled={saving}
                  onChange={(e) => handleAssign(e.target.value)}
                  title="Salesperson credited for this event (drives commission)"
                  className="flex h-9 rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                  aria-label="Assigned salesperson"
                >
                  <option value="">Unassigned</option>
                  {salespeople.map((u) => (
                    <option key={u.id} value={u.id}>{u.first_name} {u.last_name}</option>
                  ))}
                </select>
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
                  <Button
                    variant="destructive"
                    size="sm"
                    onClick={() => { setError(null); setShowDeleteConfirm(true); }}
                  >
                    Delete
                  </Button>
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
          <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide mb-3">Customer &amp; Venue</h2>
            {editing ? (
              <BookingDetailsForm
                value={bookingValue}
                onChange={applyBookingPatch}
                eventTypes={eventTypesData}
                mealTypes={mealTypesData}
                serviceStyles={serviceStylesData}
                customerAddress={orgContacts.find((c) => c.id === formContact)?.address}
                showNotes
              />
            ) : (
              <dl className="grid grid-cols-2 md:grid-cols-3 gap-4">
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
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-foreground mb-1">Setup Time</label>
                  <ValidatedInput type="datetime-local" value={formSetupTime} onChange={(e) => setFormSetupTime(e.target.value)} />
                </div>
                <div>
                  <label className="block text-sm font-medium text-foreground mb-1">Guest Arrival Time</label>
                  <ValidatedInput type="datetime-local" value={formArrivalTime} onChange={(e) => setFormArrivalTime(e.target.value)} />
                </div>
                <div>
                  <label className="block text-sm font-medium text-foreground mb-1">Meal Time</label>
                  <ValidatedInput type="datetime-local" value={formMealTime} onChange={(e) => setFormMealTime(e.target.value)} />
                </div>
                <div>
                  <label className="block text-sm font-medium text-foreground mb-1">End Time</label>
                  <ValidatedInput type="datetime-local" value={formEndTime} onChange={(e) => setFormEndTime(e.target.value)} />
                </div>
              </div>
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
                  value={{ gents: formGents, ladies: formLadies, custom_split: formCustomSplit, big_eaters: formBigEaters, big_eaters_percentage: formBigEatersPercent }}
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
                  <InfoRow label="Total Guests" value={event!.gents + event!.ladies} />
                  <InfoRow label="Gents" value={event!.gents} />
                  <InfoRow label="Ladies" value={event!.ladies} />
                  {event!.big_eaters && <InfoRow label="Big Eaters" value={`+${event!.big_eaters_percentage}%`} />}
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
                      guestCount={event!.gents + event!.ladies}
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
        const guests = editing ? totalGuests : ((event?.gents || 0) + (event?.ladies || 0));
        const foodTotal = pph * guests;
        const meals = editing ? formAdditionalMeals : (event?.additional_meals || []);
        const mealsTotal = meals.reduce((sum, m) => sum + m.guest_count * (parseFloat(m.price_per_head || "0") || 0), 0);
        const mealRows = meals
          .map((m) => ({ m, total: m.guest_count * (parseFloat(m.price_per_head || "0") || 0) }))
          .filter((r) => r.total > 0)
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
        const computed = computeBookingTotals(foodTotal + mealsTotal, liItems, guests, taxable ? taxRate : 0);
        const subtotal = editing ? computed.subtotal : parseFloat(event?.subtotal || "0");
        const taxAmount = editing ? computed.tax_amount : parseFloat(event?.tax_amount || "0");
        const grandTotal = editing ? computed.total : parseFloat(event?.total || "0");

        return (
          <BookingTotalsCard
            title="Pricing"
            currencySymbol={settings.currency_symbol}
            foodTotal={foodTotal}
            foodLabel={`Food (${formatCurrency(pph, settings.currency_symbol)}/head × ${guests} guests)`}
            meals={mealRows}
            addOnsTotal={addOnsTotal}
            subtotal={subtotal}
            taxAmount={taxAmount}
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
