"use client";

import { useEffect, useState, useCallback, useRef } from "react";
import { useParams, useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import {
  api,
  EventData,
  EventArrangement,
  EventBeverage,
  EventMealData,
  Contact,
} from "@/lib/api";
import {
  useEvent,
  useAccounts,
  useVenues,
  useLaborRoles,
  useStaff,
  useSiteSettings,
  useDateFormat,
  useEventTypes,
  useServiceStyles,
  useMealTypes,
  useArrangementTypes,
  useBeverageTypes,
} from "@/lib/hooks";
import { formatDate, formatDateTime as sharedFormatDateTime } from "@/lib/dateFormat";
import MenuBuilder from "@/components/MenuBuilder";
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
  const { data: venues = [] } = useVenues();
  const { data: laborRoles = [] } = useLaborRoles();
  const { data: staffList = [] } = useStaff();
  const { data: arrangementTypesData = [] } = useArrangementTypes();
  const arrangementTypeLabels: Record<string, string> = Object.fromEntries(arrangementTypesData.map((at) => [at.value, at.label]));
  const { data: beverageTypesData = [] } = useBeverageTypes();
  const beverageTypeLabels: Record<string, string> = Object.fromEntries(beverageTypesData.map((bt) => [bt.value, bt.label]));
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
  const [editing, setEditing] = useState(isNew);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [formStatus, setFormStatus] = useState("tentative");

  // Menu state for create mode (no event ID to persist to yet)
  const [menuData, setMenuData] = useState<{
    dish_ids: number[];
    based_on_template: number | null;
  }>({ dish_ids: [], based_on_template: null });

  // Venue mode
  const [venueMode, setVenueMode] = useState<"saved" | "custom">("saved");

  // Form fields (used in edit mode)
  const [formDate, setFormDate] = useState("");
  const [formAccount, setFormAccount] = useState<number | null>(null);
  const [formContact, setFormContact] = useState<number | null>(null);
  const [formVenue, setFormVenue] = useState<number | null>(null);
  const [formVenueAddress, setFormVenueAddress] = useState("");
  const [formEventType, setFormEventType] = useState("");
  const [formMealType, setFormMealType] = useState("");
  const [formBookingDate, setFormBookingDate] = useState("");
  const [formServiceStyle, setFormServiceStyle] = useState("");
  const [formPricePerHead, setFormPricePerHead] = useState("");
  const [formNotes, setFormNotes] = useState("");
  const [formKitchenInstructions, setFormKitchenInstructions] = useState("");
  const [formBanquetInstructions, setFormBanquetInstructions] = useState("");
  const [formSetupInstructions, setFormSetupInstructions] = useState("");

  // Guest form fields
  const [formTotalGuests, setFormTotalGuests] = useState(0);
  const [formCustomSplit, setFormCustomSplit] = useState(false);
  const [formGents, setFormGents] = useState(0);
  const [formLadies, setFormLadies] = useState(0);
  const [formGuaranteed, setFormGuaranteed] = useState<number | null>(null);
  const [formFinalCount, setFormFinalCount] = useState<number | null>(null);
  const [formFinalCountDue, setFormFinalCountDue] = useState("");
  const [formBigEaters, setFormBigEaters] = useState(false);
  const [formBigEatersPercent, setFormBigEatersPercent] = useState(0);

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

  // Arrangements state
  const [formArrangements, setFormArrangements] = useState<EventArrangement[]>([]);
  // Beverages state
  const [formBeverages, setFormBeverages] = useState<EventBeverage[]>([]);
  // Tax
  const [formIsTaxable, setFormIsTaxable] = useState(false);
  // Additional meals
  const [formAdditionalMeals, setFormAdditionalMeals] = useState<EventMealData[]>([]);

  const syncFormToEvent = useCallback((data: EventData) => {
    setFormDate(data.date);
    setFormAccount(data.account);
    setFormContact(data.primary_contact);
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
    setVenueMode(data.venue ? "saved" : data.venue_address ? "custom" : "saved");
    const total = data.gents + data.ladies;
    setFormTotalGuests(total);
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
    setFormArrangements(data.arrangements || []);
    setFormBeverages(data.beverages || []);
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
    if (!formAccount) {
      setError("Account is required");
      return;
    }
    setSaving(true);
    const accountName = accounts.find((a) => a.id === formAccount)?.name || "Event";
    const payload = {
      name: `${accountName} — ${formDate}`,
      date: formDate,
      account: formAccount,
      primary_contact: formContact,
      venue: venueMode === "saved" ? formVenue : null,
      venue_address: venueMode === "custom" ? formVenueAddress : "",
      event_type: formEventType,
      meal_type: formMealType,
      booking_date: formBookingDate || null,
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
      final_count_due: formFinalCountDue || null,
      big_eaters: formBigEaters,
      big_eaters_percentage: formBigEatersPercent,
      setup_time: formSetupTime || null,
      guest_arrival_time: formArrivalTime || null,
      meal_time: formMealTime || null,
      end_time: formEndTime || null,
      is_taxable: formIsTaxable,
      arrangements: formArrangements.map(({ arrangement_type, quantity, unit_price, notes }) => ({ arrangement_type, quantity, unit_price, notes })),
      beverages: formBeverages.map(({ beverage_type, quantity, unit_price, notes }) => ({ beverage_type, quantity, unit_price, notes })),
      additional_meals: formAdditionalMeals.map(({ label, guest_count, price_per_head, dishes, based_on_template, meal_time, notes }) => ({
        label, guest_count, price_per_head: price_per_head || null, dishes, dish_ids: dishes, based_on_template, meal_time: meal_time || null, notes,
      })),
    };
    try {
      if (isNew) {
        const created = await api.createEvent({
          ...payload,
          status: formStatus,
          dish_ids: menuData.dish_ids,
          based_on_template: menuData.based_on_template,
        });
        router.push(`/events/${created.id}`);
      } else {
        await api.updateEvent(event!.id, payload as Partial<EventData>);
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

  const handleStatusTransition = async (newStatus: string) => {
    if (!event) return;
    setSaving(true);
    try {
      await api.updateEvent(event.id, { status: newStatus } as Partial<EventData>);
      await mutateEvent();
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

  const handleToggleArrangement = (value: string) => {
    setFormArrangements((prev) => {
      const exists = prev.find((a) => a.arrangement_type === value);
      if (exists) return prev.filter((a) => a.arrangement_type !== value);
      return [...prev, { arrangement_type: value, quantity: 1, unit_price: "0", notes: "" }];
    });
  };

  const handleArrangementField = (value: string, field: "quantity" | "unit_price" | "notes", fieldValue: number | string) => {
    setFormArrangements((prev) => prev.map((a) => a.arrangement_type === value ? { ...a, [field]: fieldValue } : a));
  };

  const handleToggleBeverage = (value: string) => {
    setFormBeverages((prev) => {
      const exists = prev.find((b) => b.beverage_type === value);
      if (exists) return prev.filter((b) => b.beverage_type !== value);
      return [...prev, { beverage_type: value, quantity: 1, unit_price: "0", notes: "" }];
    });
  };

  const handleBeverageField = (value: string, field: "quantity" | "unit_price" | "notes", fieldValue: number | string) => {
    setFormBeverages((prev) => prev.map((b) => b.beverage_type === value ? { ...b, [field]: fieldValue } : b));
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
        subtotal: "0.00",
        tax_rate: "0.2000",
        tax_amount: "0.00",
        total: "0.00",
      });
      await mutateEvent();
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Failed to create invoice");
    } finally {
      setSaving(false);
    }
  };

  // Contacts for selected account
  const selectedAccount = accounts.find((a) => a.id === (editing || isNew ? formAccount : event?.account));
  const contactsForAccount: Contact[] = selectedAccount?.contacts || [];

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
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-foreground mb-1">Account *</label>
                  <select
                    required
                    value={formAccount ?? ""}
                    onChange={(e) => {
                      const val = e.target.value ? Number(e.target.value) : null;
                      setFormAccount(val);
                      setFormContact(null);
                    }}
                    className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                  >
                    <option value="">-- Select Account --</option>
                    {accounts.map((a) => (
                      <option key={a.id} value={a.id}>{a.name}</option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="block text-sm font-medium text-foreground mb-1">Primary Contact</label>
                  <select
                    value={formContact ?? ""}
                    onChange={(e) => setFormContact(e.target.value ? Number(e.target.value) : null)}
                    disabled={!formAccount}
                    className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    <option value="">-- Select Contact --</option>
                    {contactsForAccount.map((c) => (
                      <option key={c.id} value={c.id}>{c.name} {c.role ? `(${c.role})` : ""}</option>
                    ))}
                  </select>
                </div>
                <div className="md:col-span-2">
                  <label className="block text-sm font-medium text-foreground mb-1">Venue</label>
                  <div className="flex gap-4 mb-2">
                    <label className="flex items-center gap-1.5 text-sm">
                      <input type="radio" name="venueMode" checked={venueMode === "saved"} onChange={() => setVenueMode("saved")} className="text-primary" />
                      Saved Venue
                    </label>
                    <label className="flex items-center gap-1.5 text-sm">
                      <input type="radio" name="venueMode" checked={venueMode === "custom"} onChange={() => setVenueMode("custom")} className="text-primary" />
                      Custom Address
                    </label>
                  </div>
                  {venueMode === "saved" ? (
                    <select
                      value={formVenue ?? ""}
                      onChange={(e) => setFormVenue(e.target.value ? Number(e.target.value) : null)}
                      className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                    >
                      <option value="">-- Select Venue --</option>
                      {venues.map((v) => (
                        <option key={v.id} value={v.id}>{v.name} - {v.city}</option>
                      ))}
                    </select>
                  ) : (
                    <Textarea
                      value={formVenueAddress}
                      onChange={(e) => setFormVenueAddress(e.target.value)}
                      rows={3}
                      maxLength={300}
                      placeholder="Enter venue address..."
                    />
                  )}
                </div>
                <div>
                  <label className="block text-sm font-medium text-foreground mb-1">Event Type</label>
                  <select
                    value={formEventType}
                    onChange={(e) => setFormEventType(e.target.value)}
                    className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                  >
                    <option value="">-- Select --</option>
                    {Object.entries(eventTypeLabels).map(([key, label]) => (
                      <option key={key} value={key}>{label}</option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="block text-sm font-medium text-foreground mb-1">Meal Type</label>
                  <select
                    value={formMealType}
                    onChange={(e) => setFormMealType(e.target.value)}
                    className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                  >
                    <option value="">-- Select --</option>
                    {Object.entries(mealTypeLabels).map(([key, label]) => (
                      <option key={key} value={key}>{label}</option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="block text-sm font-medium text-foreground mb-1">Service Style</label>
                  <select
                    value={formServiceStyle}
                    onChange={(e) => setFormServiceStyle(e.target.value)}
                    className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                  >
                    <option value="">-- Select --</option>
                    {Object.entries(serviceStyleLabels).map(([key, label]) => (
                      <option key={key} value={key}>{label}</option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="block text-sm font-medium text-foreground mb-1">Booking Date</label>
                  <ValidatedInput
                    type="date"
                    value={formBookingDate}
                    onChange={(e) => setFormBookingDate(e.target.value)}
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-foreground mb-1">Notes</label>
                  <Textarea
                    value={formNotes}
                    onChange={(e) => setFormNotes(e.target.value)}
                    rows={2}
                    maxLength={2000}
                  />
                </div>
              </div>
            ) : (
              <dl className="grid grid-cols-2 md:grid-cols-3 gap-4">
                <InfoRow label="Account" value={event!.account_name} />
                <InfoRow label="Primary Contact" value={event!.contact_name} />
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
                <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
                  <div>
                    <label className="block text-sm font-medium text-foreground mb-1">Total Guests</label>
                    <ValidatedInput
                      type="number"
                      min={1}
                      max={100000}
                      value={formTotalGuests || ""}
                      onChange={(e) => {
                        const total = Math.max(0, Number(e.target.value) || 0);
                        setFormTotalGuests(total);
                        if (formCustomSplit) {
                          const prevTotal = formGents + formLadies;
                          const ratio = prevTotal > 0 ? formGents / prevTotal : 0.5;
                          const gents = Math.round(total * ratio);
                          setFormGents(gents);
                          setFormLadies(total - gents);
                        } else {
                          setFormGents(Math.ceil(total / 2));
                          setFormLadies(Math.floor(total / 2));
                        }
                      }}
                    />
                  </div>
                  <div className="flex items-end pb-1">
                    <label className="flex items-center gap-2 text-sm text-foreground cursor-pointer">
                      <input
                        type="checkbox"
                        checked={formCustomSplit}
                        onChange={(e) => {
                          const custom = e.target.checked;
                          setFormCustomSplit(custom);
                          if (!custom) {
                            setFormGents(Math.ceil(formTotalGuests / 2));
                            setFormLadies(Math.floor(formTotalGuests / 2));
                          }
                        }}
                        className="rounded border-input"
                      />
                      Customise split
                    </label>
                  </div>
                </div>
                {formCustomSplit && (
                  <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
                    <div>
                      <label className="block text-sm font-medium text-foreground mb-1">Gents</label>
                      <ValidatedInput
                        type="number"
                        min={0}
                        max={formTotalGuests}
                        value={formGents}
                        onChange={(e) => {
                          const gents = Math.max(0, Number(e.target.value) || 0);
                          setFormGents(gents);
                          setFormLadies(Math.max(0, formTotalGuests - gents));
                        }}
                      />
                    </div>
                    <div>
                      <label className="block text-sm font-medium text-foreground mb-1">Ladies</label>
                      <ValidatedInput
                        type="number"
                        min={0}
                        max={formTotalGuests}
                        value={formLadies}
                        onChange={(e) => {
                          const ladies = Math.max(0, Number(e.target.value) || 0);
                          setFormLadies(ladies);
                          setFormGents(Math.max(0, formTotalGuests - ladies));
                        }}
                      />
                    </div>
                  </div>
                )}
                {!formCustomSplit && formTotalGuests > 0 && (
                  <p className="text-xs text-muted-foreground">
                    Split: {Math.ceil(formTotalGuests / 2)} gents / {Math.floor(formTotalGuests / 2)} ladies
                  </p>
                )}
                <div className="flex items-end pb-1">
                  <label className="flex items-center gap-2 text-sm">
                    <input type="checkbox" checked={formBigEaters} onChange={(e) => setFormBigEaters(e.target.checked)} className="rounded border-input text-primary focus:ring-ring" />
                    <span className="font-medium text-foreground">Big Eaters</span>
                  </label>
                  {formBigEaters && (
                    <div className="ml-4 flex items-center gap-1.5">
                      <ValidatedInput type="number" min={0} max={100} value={formBigEatersPercent} onChange={(e) => setFormBigEatersPercent(Number(e.target.value))} className="w-20 h-8" />
                      <span className="text-xs text-muted-foreground">%</span>
                    </div>
                  )}
                </div>
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
                      guestCount={formTotalGuests}
                      currencySymbol={settings.currency_symbol}
                    />
                  ) : (
                    <MenuBuilder
                      selectedDishIds={event!.dishes}
                      basedOnTemplate={event!.based_on_template}
                      onSave={handleMenuSave}
                      pricePerHead={formPricePerHead}
                      onPricePerHeadChange={setFormPricePerHead}
                      guestCount={formTotalGuests}
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
      <Card>
        <CardContent className="p-6">
          <div className="flex items-center justify-between mb-3">
            <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide">Additional Meals</h2>
            {editing && (
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => setFormAdditionalMeals([...formAdditionalMeals, {
                  label: "",
                  guest_count: 0,
                  price_per_head: null,
                  dishes: [],
                  based_on_template: null,
                  meal_time: null,
                  notes: "",
                }])}
              >
                + Add Meal
              </Button>
            )}
          </div>
          {formAdditionalMeals.length === 0 && !editing && (
            <p className="text-sm text-muted-foreground">No additional meals.</p>
          )}
          {formAdditionalMeals.length === 0 && editing && (
            <p className="text-sm text-muted-foreground">No additional meals added.</p>
          )}
          <div className="space-y-4">
            {formAdditionalMeals.map((meal, idx) => (
              <div key={idx} className="border border-border rounded-lg p-4 space-y-3">
                <div className="flex items-center justify-between gap-2">
                  {editing ? (
                    <input
                      type="text"
                      placeholder="Meal label"
                      value={meal.label}
                      onChange={(e) => {
                        const updated = [...formAdditionalMeals];
                        updated[idx] = { ...updated[idx], label: e.target.value };
                        setFormAdditionalMeals(updated);
                      }}
                      className="flex h-9 rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring flex-1"
                    />
                  ) : (
                    <span className="font-medium text-foreground">{meal.label || "Untitled Meal"}</span>
                  )}
                  {editing && (
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      className="text-destructive"
                      onClick={() => setFormAdditionalMeals(formAdditionalMeals.filter((_, i) => i !== idx))}
                    >
                      Remove
                    </Button>
                  )}
                </div>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                  <div>
                    <label className="block text-sm font-medium text-foreground mb-1">Guest Count</label>
                    {editing ? (
                      <ValidatedInput
                        type="number"
                        min={0}
                        value={meal.guest_count}
                        onChange={(e) => {
                          const updated = [...formAdditionalMeals];
                          updated[idx] = { ...updated[idx], guest_count: parseInt(e.target.value) || 0 };
                          setFormAdditionalMeals(updated);
                        }}
                      />
                    ) : (
                      <span className="text-sm">{meal.guest_count}</span>
                    )}
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-foreground mb-1">Meal Time</label>
                    {editing ? (
                      <ValidatedInput
                        type="datetime-local"
                        value={meal.meal_time ? meal.meal_time.slice(0, 16) : ""}
                        onChange={(e) => {
                          const updated = [...formAdditionalMeals];
                          updated[idx] = { ...updated[idx], meal_time: e.target.value || null };
                          setFormAdditionalMeals(updated);
                        }}
                      />
                    ) : (
                      <span className="text-sm">{meal.meal_time ? sharedFormatDateTime(meal.meal_time, dateFormat) : "\u2014"}</span>
                    )}
                  </div>
                </div>
                {editing && (
                  <div>
                    <label className="block text-sm font-medium text-foreground mb-1">Notes</label>
                    <Textarea
                      value={meal.notes}
                      onChange={(e) => {
                        const updated = [...formAdditionalMeals];
                        updated[idx] = { ...updated[idx], notes: e.target.value };
                        setFormAdditionalMeals(updated);
                      }}
                      rows={2}
                      placeholder="Special instructions for this meal..."
                    />
                  </div>
                )}
                {!editing && meal.notes && (
                  <div>
                    <label className="block text-sm font-medium text-muted-foreground mb-1">Notes</label>
                    <p className="text-sm">{meal.notes}</p>
                  </div>
                )}
                <MenuBuilder
                  selectedDishIds={meal.dishes}
                  basedOnTemplate={meal.based_on_template}
                  onChange={(data) => {
                    const updated = [...formAdditionalMeals];
                    updated[idx] = { ...updated[idx], dishes: data.dish_ids, based_on_template: data.based_on_template };
                    setFormAdditionalMeals(updated);
                  }}
                  pricePerHead={meal.price_per_head || ""}
                  onPricePerHeadChange={editing ? (val) => {
                    const updated = [...formAdditionalMeals];
                    updated[idx] = { ...updated[idx], price_per_head: val || null };
                    setFormAdditionalMeals(updated);
                  } : undefined}
                  guestCount={meal.guest_count}
                  currencySymbol={settings.currency_symbol}
                  disabled={!editing}
                />
              </div>
            ))}
          </div>
        </CardContent>
      </Card>

      {/* Arrangements & Beverages — 2-column layout */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        {/* Arrangements */}
        <Card>
          <CardContent className="p-6">
            <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide mb-3">Arrangements</h2>
            {editing ? (
              <div className="space-y-3">
                {arrangementTypesData.map((at) => {
                  const selected = formArrangements.find((a) => a.arrangement_type === at.value);
                  return (
                    <div key={at.value}>
                      <label className="flex items-center gap-2 cursor-pointer">
                        <input
                          type="checkbox"
                          checked={!!selected}
                          onChange={() => handleToggleArrangement(at.value)}
                          className="rounded border-input"
                        />
                        <span className="text-sm text-foreground">{at.label}</span>
                      </label>
                      {selected && (
                        <div className="flex items-center gap-2 mt-1.5 ml-6">
                          <ValidatedInput
                            type="number"
                            min={1}
                            value={selected.quantity}
                            onChange={(e) => handleArrangementField(at.value, "quantity", Number(e.target.value) || 1)}
                            className="w-16 h-8"
                          />
                          <span className="text-xs text-muted-foreground">qty</span>
                          <ValidatedInput
                            type="number"
                            step="0.01"
                            min={0}
                            value={selected.unit_price}
                            onChange={(e) => handleArrangementField(at.value, "unit_price", e.target.value)}
                            placeholder="0.00"
                            className="w-24 h-8"
                          />
                          <span className="text-xs text-muted-foreground">{settings.currency_symbol}/ea</span>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            ) : !isNew && (
              (event!.arrangements?.length > 0) ? (
                <div className="space-y-1.5">
                  {event!.arrangements.map((arr) => (
                    <div key={arr.arrangement_type} className="flex items-baseline gap-2">
                      <span className="text-sm text-foreground font-medium">{arrangementTypeLabels[arr.arrangement_type] || arr.arrangement_type}</span>
                      <span className="text-sm text-muted-foreground">
                        x{arr.quantity}
                        {parseFloat(arr.unit_price) > 0 && ` @ ${formatCurrency(arr.unit_price, settings.currency_symbol)}`}
                      </span>
                    </div>
                  ))}
                </div>
              ) : (
                <p className="text-sm text-muted-foreground">No arrangements added.</p>
              )
            )}
          </CardContent>
        </Card>

        {/* Beverages */}
        <Card>
          <CardContent className="p-6">
            <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide mb-3">Beverages</h2>
            {editing ? (
              <div className="space-y-3">
                {beverageTypesData.map((bt) => {
                  const selected = formBeverages.find((b) => b.beverage_type === bt.value);
                  return (
                    <div key={bt.value}>
                      <label className="flex items-center gap-2 cursor-pointer">
                        <input
                          type="checkbox"
                          checked={!!selected}
                          onChange={() => handleToggleBeverage(bt.value)}
                          className="rounded border-input"
                        />
                        <span className="text-sm text-foreground">{bt.label}</span>
                      </label>
                      {selected && (
                        <div className="flex items-center gap-2 mt-1.5 ml-6">
                          <ValidatedInput
                            type="number"
                            min={1}
                            value={selected.quantity}
                            onChange={(e) => handleBeverageField(bt.value, "quantity", Number(e.target.value) || 1)}
                            className="w-16 h-8"
                          />
                          <span className="text-xs text-muted-foreground">qty</span>
                          <ValidatedInput
                            type="number"
                            step="0.01"
                            min={0}
                            value={selected.unit_price}
                            onChange={(e) => handleBeverageField(bt.value, "unit_price", e.target.value)}
                            placeholder="0.00"
                            className="w-24 h-8"
                          />
                          <span className="text-xs text-muted-foreground">{settings.currency_symbol}/ea</span>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            ) : !isNew && (
              (event!.beverages?.length > 0) ? (
                <div className="space-y-1.5">
                  {event!.beverages.map((bev) => (
                    <div key={bev.beverage_type} className="flex items-baseline gap-2">
                      <span className="text-sm text-foreground font-medium">{beverageTypeLabels[bev.beverage_type] || bev.beverage_type}</span>
                      <span className="text-sm text-muted-foreground">
                        x{bev.quantity}
                        {parseFloat(bev.unit_price) > 0 && ` @ ${formatCurrency(bev.unit_price, settings.currency_symbol)}`}
                      </span>
                    </div>
                  ))}
                </div>
              ) : (
                <p className="text-sm text-muted-foreground">No beverages added.</p>
              )
            )}
          </CardContent>
        </Card>
      </div>

      {/* Pricing Section */}
      <Card>
        <CardContent className="p-6">
          <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide mb-3">Pricing</h2>
          {(() => {
            const pph = editing ? parseFloat(formPricePerHead) || 0 : parseFloat(event?.price_per_head || "0");
            const guests = editing ? formTotalGuests : ((event?.gents || 0) + (event?.ladies || 0));
            const foodTotal = pph * guests;
            const meals = editing ? formAdditionalMeals : (event?.additional_meals || []);
            const mealsTotal = meals.reduce((sum, m) => sum + m.guest_count * (parseFloat(m.price_per_head || "0") || 0), 0);
            const arrItems = editing ? formArrangements : (event?.arrangements || []);
            const bevItems = editing ? formBeverages : (event?.beverages || []);
            const arrTotal = arrItems.reduce((sum, a) => sum + a.quantity * (parseFloat(a.unit_price) || 0), 0);
            const bevTotal = bevItems.reduce((sum, b) => sum + b.quantity * (parseFloat(b.unit_price) || 0), 0);
            const subtotal = foodTotal + mealsTotal + arrTotal + bevTotal;
            const taxable = editing ? formIsTaxable : (event?.is_taxable || false);
            const taxRate = parseFloat(settings.default_tax_rate) || 0;
            const taxAmount = taxable ? subtotal * taxRate : 0;
            const grandTotal = subtotal + taxAmount;

            return (
              <div className="space-y-4">
                <div className="border border-border rounded-lg divide-y divide-border">
                  <div className="flex justify-between px-4 py-2 text-sm">
                    <span className="text-muted-foreground">Food ({formatCurrency(pph, settings.currency_symbol)}/head × {guests} guests)</span>
                    <span className="font-medium text-foreground">{formatCurrency(foodTotal, settings.currency_symbol)}</span>
                  </div>
                  {meals.map((m, i) => {
                    const mTotal = m.guest_count * (parseFloat(m.price_per_head || "0") || 0);
                    return mTotal > 0 ? (
                      <div key={i} className="flex justify-between px-4 py-2 text-sm">
                        <span className="text-muted-foreground">{m.label || "Additional Meal"} ({formatCurrency(m.price_per_head || "0", settings.currency_symbol)}/head × {m.guest_count})</span>
                        <span className="font-medium text-foreground">{formatCurrency(mTotal, settings.currency_symbol)}</span>
                      </div>
                    ) : null;
                  })}
                  {arrTotal > 0 && (
                    <div className="flex justify-between px-4 py-2 text-sm">
                      <span className="text-muted-foreground">Arrangements</span>
                      <span className="font-medium text-foreground">{formatCurrency(arrTotal, settings.currency_symbol)}</span>
                    </div>
                  )}
                  {bevTotal > 0 && (
                    <div className="flex justify-between px-4 py-2 text-sm">
                      <span className="text-muted-foreground">Beverages</span>
                      <span className="font-medium text-foreground">{formatCurrency(bevTotal, settings.currency_symbol)}</span>
                    </div>
                  )}
                  <div className="flex justify-between px-4 py-2 text-sm font-medium">
                    <span className="text-foreground">Subtotal</span>
                    <span className="text-foreground">{formatCurrency(subtotal, settings.currency_symbol)}</span>
                  </div>
                  <div className="flex justify-between items-center px-4 py-2 text-sm">
                    <span className="text-muted-foreground flex items-center gap-2">
                      {editing ? (
                        <label className="flex items-center gap-2 cursor-pointer">
                          <input
                            type="checkbox"
                            checked={formIsTaxable}
                            onChange={(e) => setFormIsTaxable(e.target.checked)}
                            className="rounded border-input"
                          />
                          {settings.tax_label} ({(taxRate * 100).toFixed(0)}%)
                        </label>
                      ) : (
                        <span>{settings.tax_label} ({(taxRate * 100).toFixed(0)}%){!taxable && " — not applied"}</span>
                      )}
                    </span>
                    <span className="font-medium text-foreground">{taxable ? formatCurrency(taxAmount, settings.currency_symbol) : "—"}</span>
                  </div>
                  <div className="flex justify-between px-4 py-3 text-base font-bold bg-muted/30">
                    <span className="text-foreground">Total</span>
                    <span className="text-foreground">{formatCurrency(grandTotal, settings.currency_symbol)}</span>
                  </div>
                </div>
              </div>
            );
          })()}
        </CardContent>
      </Card>

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
    </div>
  );
}
