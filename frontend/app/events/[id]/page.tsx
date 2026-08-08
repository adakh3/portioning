"use client";

import { useEffect, useState, useCallback, useRef } from "react";
import { useParams, useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import {
  api,
  EventData,
  EventMealData,
  CourseData,
  MenuChoices,
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
  useTimelinePresets,
  useUsers,
  useProductLines,
} from "@/lib/hooks";
import DealWonDialog from "@/components/DealWonDialog";
import EventPaymentsCard from "@/components/EventPaymentsCard";
import { useAuth } from "@/lib/auth";
import { formatDate, todayISO } from "@/lib/dateFormat";
import { LineItemInput, lineItemTotal, computeBookingTotals, buildEventSavePayload, segmentFood, segmentFoodRows, defaultSegmentRemainder, hasVendorDoubleEntry, mealsFood, bookingMealRows, timelineMealRows, GuestSegmentMeta } from "@/lib/quoteTotals";
import BookingTotalsCard from "@/components/BookingTotalsCard";
import AddOnItemsEditor from "@/components/AddOnItemsEditor";
import MenuBuilder from "@/components/MenuBuilder";
import AdditionalMealsEditor from "@/components/AdditionalMealsEditor";
import { guestsChoose } from "@/lib/menuStructure";
import FinalNumbersPanel from "@/components/FinalNumbersPanel";
import FinalsPill from "@/components/FinalsPill";
import GuestCountField, { GuestCountValue } from "@/components/GuestCountField";
import SegmentRatesField from "@/components/SegmentRatesField";
import BookingTimelineField, { TimelineEntryValue } from "@/components/BookingTimelineField";
import BookingTimelineView from "@/components/BookingTimelineView";
import BookingDetailsForm, { BookingDetailsValue } from "@/components/BookingDetailsForm";
import AssigneePicker from "@/components/AssigneePicker";
import { Button } from "@/components/ui/button";
import ESignPanel from "@/components/ESignPanel";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { ValidatedInput } from "@/components/ui/validated-input";
import { Textarea } from "@/components/ui/textarea";
import { formatCurrency, formatPercent } from "@/lib/utils";

// Statuses in which the finals panel + pill apply — mirrors FINALS_STATUSES on the
// backend, which derives `finals_status` itself.
const FINALS_STATUSES = ["confirmed", "in_progress", "completed"];

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
  const segmentMeta = (rawSettings?.guest_segments ?? []) as GuestSegmentMeta[];
  const dateFormat = useDateFormat();
  const timeFormat: "12h" | "24h" = ((rawSettings as { time_format?: string } | undefined)?.time_format === "12h") ? "12h" : "24h";
  const { data: eventTypesData = [] } = useEventTypes();
  const { data: serviceStylesData = [] } = useServiceStyles();
  const { data: mealTypesData = [] } = useMealTypes();
  const { data: timelinePresets = [] } = useTimelinePresets();
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
  // Courses (Starter/Entrée/Dessert + service style) + dish→course map (REL-417).
  const [formCourses, setFormCourses] = useState<CourseData[]>([]);
  const [formDishCourses, setFormDishCourses] = useState<Record<string, number>>({});
  // Offered entrée choices + any tallies already recorded (REL-419). Hydrated from
  // the event and echoed back on save so the finals panel's numbers survive an
  // ordinary edit of the menu.
  const [formMenuChoices, setFormMenuChoices] = useState<MenuChoices>({});
  /** The one Menu card reports all three together (REL-451) — courses, the dish→course
   * map and the choice flags move as one structure, so a dish changing course can clear
   * its flag in the same update rather than in two racing setStates. */
  const handleStructureChange = ({ courses, dishCourses, menuChoices }: {
    courses: CourseData[];
    dishCourses: Record<string, number>;
    menuChoices: MenuChoices;
  }) => {
    setFormCourses(courses);
    setFormDishCourses(dishCourses);
    setFormMenuChoices(menuChoices);
  };

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
  const [formSegmentCounts, setFormSegmentCounts] = useState<Record<string, number>>({});
  const [formSegmentPrices, setFormSegmentPrices] = useState<Record<string, string>>({});
  const [formBigEaters, setFormBigEaters] = useState(false);
  const [formBigEatersPercent, setFormBigEatersPercent] = useState(0);
  const totalGuests = formGuestCount;
  // Adapter for the shared GuestCountField (canonical value = guest_count).
  const applyGuestPatch = (patch: Partial<GuestCountValue>) => {
    if (patch.guest_count !== undefined) setFormGuestCount(patch.guest_count);
    if (patch.segment_counts !== undefined) setFormSegmentCounts(patch.segment_counts);
    if (patch.segment_prices !== undefined) setFormSegmentPrices(patch.segment_prices);
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
  const [formTimeline, setFormTimeline] = useState<TimelineEntryValue[]>([]);

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
    // Rehydrate the explicit per-segment breakdown from the saved rows (the
    // default segment's entry is ignored downstream — it's the derived remainder).
    setFormSegmentCounts(Object.fromEntries((data.guest_counts ?? []).map((r) => [r.segment, r.count])));
    setFormSegmentPrices(Object.fromEntries((data.guest_counts ?? []).filter((r) => r.price_per_head != null).map((r) => [r.segment, String(r.price_per_head)])));
    setFormBigEaters(data.big_eaters);
    setFormBigEatersPercent(data.big_eaters_percentage);
    setFormSetupTime(data.setup_time ? data.setup_time.slice(0, 16) : "");
    setFormArrivalTime(data.guest_arrival_time ? data.guest_arrival_time.slice(0, 16) : "");
    setFormMealTime(data.meal_time ? data.meal_time.slice(0, 16) : "");
    setFormEndTime(data.end_time ? data.end_time.slice(0, 16) : "");
    setFormTimeline((data.timeline_entries || []).map((e) => ({
      id: e.id, time: e.time.slice(0, 5), label: e.label, date: e.date || "",
    })));
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
    setFormCourses(data.courses || []);
    setFormDishCourses(data.dish_courses || {});
    setFormMenuChoices(data.menu_choices || {});
    // The save payload always sends `dish_ids: menuData.dish_ids`, and the edit-mode
    // MenuBuilder instant-saves via onSave rather than onChange — so without this the
    // menu state stayed [] for an existing event and saving the form WIPED its menu
    // (and, because courses can only reference dishes on the booking, its course
    // assignments with it). Hydrating here also gives CoursesEditor the dish list it
    // needs to render the "Assign dishes" dropdowns on an existing event.
    setMenuData({ dish_ids: data.dishes || [], based_on_template: data.based_on_template ?? null });
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
    if (defaultSegmentRemainder(formGuestCount, formSegmentCounts, segmentMeta) < 0) {
      setError(`The breakdown is more than the guest count (${formGuestCount})`);
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
      segment_counts: formSegmentCounts,
      segment_prices: formSegmentPrices,
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
      timeline_entries: formTimeline,
    }, segmentMeta, formCourses, formDishCourses, formMenuChoices);
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

  // Both documents download the same way — fetch the blob, click a synthetic link.
  // Shared so the function sheet and the BEO can't drift on error handling or
  // forget to revoke the object URL (REL-444). `fetchFile` may return a filename of
  // its own; the BEO does, because only the server knows which revision the download
  // just became.
  const handleDownload = async (
    fetchFile: () => Promise<Blob | { blob: Blob; filename: string }>,
    fallbackName: string,
  ) => {
    try {
      const result = await fetchFile();
      const blob = result instanceof Blob ? result : result.blob;
      const name = result instanceof Blob ? fallbackName : (result.filename || fallbackName);
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = name;
      a.click();
      URL.revokeObjectURL(url);
    } catch (err) {
      setError(err instanceof Error ? err.message : `Failed to download ${fallbackName}`);
    }
  };

  // Deliberate, and separate from the download for that reason: this is what tells
  // everyone holding a printed sheet that theirs is stale (REL-444).
  const handleIssueBEORevision = async () => {
    if (!event) return;
    setSaving(true);
    try {
      await api.issueBEORevision(event.id);
      await mutateEvent();
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Failed to issue a new BEO revision");
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
          {/* Both rows wrap. The left group's children (status pill, assignee picker,
              product select) have their own intrinsic widths and don't shrink, so
              without this they overflowed their `min-w-0` container and rendered
              UNDER the button group, which is `flex-shrink-0` — the product dropdown
              sat behind "Download PDF". Pre-existing; adding the BEO button (REL-444)
              made it bite at a wider viewport, so it's fixed here rather than left
              for the next button to make worse. */}
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div className="flex flex-wrap items-end gap-3 flex-1 min-w-0">
              <h1 className="text-2xl font-bold text-foreground truncate self-center">
                {isNew
                  ? (formAccount ? `${accounts.find((a) => a.id === formAccount)?.name || "New Event"}` : "New Event")
                  : event!.name}
              </h1>
              <div className="flex flex-col gap-1">
                <label className="text-xs font-medium text-muted-foreground">Status</label>
                {isNew ? (
                  <select
                    aria-label="Status"
                    value={formStatus}
                    onChange={(e) => setFormStatus(e.target.value)}
                    className="flex h-9 rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                  >
                    <option value="tentative">Tentative</option>
                    <option value="confirmed">Confirmed</option>
                  </select>
                ) : (
                  <span className="h-9 flex items-center gap-2">
                    <Badge variant={statusBadgeVariant[event!.status] || "secondary"} className="whitespace-nowrap">
                      {event!.status_display || event!.status}
                    </Badge>
                    {/* Finals reminder sits beside the status — same derived pill as
                        the events list, so the two can never disagree (REL-419). */}
                    <FinalsPill
                      status={event!.finals_status}
                      dueDate={event!.final_count_due}
                      dateFormat={dateFormat}
                    />
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
                    onClick={() => handleDownload(
                      () => api.downloadEventPDF(event!.id), `Event-${event!.id}.pdf`,
                    )}
                  >
                    Download PDF
                  </Button>
                  {/* The ops sheet the kitchen/banquet/venue work from — same event,
                      organised for the day and carrying no pricing. Downloading is a
                      pure read; the revision beside it moves only on purpose. */}
                  <Button
                    variant="outline"
                    size="sm"
                    title={`Banquet Event Order (Rev ${event!.beo_revision ?? 1}) — the day-of sheet for kitchen, banquet and venue`}
                    onClick={() => handleDownload(
                      () => api.downloadEventBEO(event!.id), `BEO-${event!.id}.pdf`,
                    )}
                  >
                    BEO {event!.beo_revision ? `· Rev ${event!.beo_revision}` : ""}
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={saving}
                    title="Issue a new BEO revision — tells kitchen, banquet and venue that the copy they hold is out of date. Use it when something on the day actually changed, not to reprint."
                    onClick={handleIssueBEORevision}
                  >
                    New revision
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
                    <ValidatedInput aria-label="Event date" type="date" value={formDate} onChange={(e) => setFormDate(e.target.value)} required />
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

      {/* Guests — entered once; every meal draws from this */}
      <Card>
        <CardContent className="p-6">
          <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide mb-3">Guests</h2>
          {editing ? (
            <>
              <GuestCountField
                value={{ guest_count: formGuestCount, segment_counts: formSegmentCounts, segment_prices: formSegmentPrices, big_eaters: formBigEaters, big_eaters_percentage: formBigEatersPercent }}
                onChange={applyGuestPatch}
              />
              {hasVendorDoubleEntry(formSegmentCounts, formAdditionalMeals, segmentMeta) && (
                <div role="alert" className="mt-2 flex items-start gap-2 rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-xs font-medium text-amber-800 dark:border-amber-700 dark:bg-amber-950/40 dark:text-amber-300">
                  <span aria-hidden="true" className="text-sm leading-none">⚠️</span>
                  <span>Possible double-count: you have <strong>vendor covers</strong> and a <strong>vendor-labelled meal</strong>. Vendors should be counted one way or the other, not both.</span>
                </div>
              )}
              {/* Guaranteed Count / Final Count / Final Count Due are hidden until
                  they actually drive money + the finals lifecycle (REL-419). The
                  form state + save payload are kept so nothing is lost; REL-419
                  re-surfaces them in the "Record final numbers" panel. */}
            </>
          ) : (
            <dl className="grid grid-cols-2 md:grid-cols-3 gap-4">
              <InfoRow label="Guest Count" value={event!.guest_count} />
              {(event!.gents > 0 || event!.ladies > 0) && <InfoRow label="Gents" value={event!.gents} />}
              {(event!.gents > 0 || event!.ladies > 0) && <InfoRow label="Ladies" value={event!.ladies} />}
              {event!.big_eaters && <InfoRow label="Hearty eaters" value={`+${event!.big_eaters_percentage}%`} />}
              {event!.guaranteed_count != null && <InfoRow label="Guaranteed Count" value={event!.guaranteed_count} />}
              {event!.final_count != null && <InfoRow label="Final Count" value={event!.final_count} />}
              {event!.final_count_due && <InfoRow label="Final Count Due" value={formatDate(event!.final_count_due, dateFormat)} />}
            </dl>
          )}
        </CardContent>
      </Card>

      {/* Main Meal Section — menu + pricing (serves everyone) */}
      <Card>
        <CardContent className="p-6">
          <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide mb-3">Main Meal</h2>
            {editing ? (
              isNew ? (
                <MenuBuilder
                  selectedDishIds={menuData.dish_ids}
                  basedOnTemplate={menuData.based_on_template}
                  onChange={setMenuData}
                  onLoadCourses={(courses, dishCourses) => { setFormCourses(courses); setFormDishCourses(dishCourses); }}
                  courses={formCourses}
                  dishCourses={formDishCourses}
                  menuChoices={formMenuChoices}
                  guestsChoose={guestsChoose(formServiceStyle, serviceStylesData)}
                  bigEaters={formBigEaters}
                  bigEatersPercentage={formBigEatersPercent}
                  serviceStyleLabel={serviceStyleLabels[formServiceStyle]}
                  onStructureChange={handleStructureChange}
                  pricePerHead={formPricePerHead}
                  onPricePerHeadChange={setFormPricePerHead}
                  guestCount={totalGuests}
                  currencySymbol={settings.currency_symbol}
                />
              ) : (
                // One save, like the quote page: the card reports dish edits through
                // onChange and the page's main Save sends them alongside the courses
                // and choice flags. It used to instant-save via onSave, which since
                // REL-451 would split one edit across two buttons — the structure
                // reaching page state at once while dish_ids waited for "Save Menu",
                // so removing a dish destroyed its tally while keeping the dish.
                <MenuBuilder
                  selectedDishIds={menuData.dish_ids}
                  basedOnTemplate={menuData.based_on_template}
                  onChange={setMenuData}
                  onLoadCourses={(courses, dishCourses) => { setFormCourses(courses); setFormDishCourses(dishCourses); }}
                  courses={formCourses}
                  dishCourses={formDishCourses}
                  menuChoices={formMenuChoices}
                  guestsChoose={guestsChoose(formServiceStyle, serviceStylesData)}
                  bigEaters={formBigEaters}
                  bigEatersPercentage={formBigEatersPercent}
                  serviceStyleLabel={serviceStyleLabels[formServiceStyle]}
                  onStructureChange={handleStructureChange}
                  pricePerHead={formPricePerHead}
                  onPricePerHeadChange={setFormPricePerHead}
                  guestCount={totalGuests}
                  currencySymbol={settings.currency_symbol}
                  disabled={false}
                />
              )
            ) : event!.dishes.length === 0 ? (
              <p className="text-sm text-muted-foreground">No menu selected.</p>
            ) : (
              // Read-only, so it reads the SAVED event rather than form state — which
              // is hydrated by an effect and would render one flat, course-less frame
              // before the real structure arrived.
              <MenuBuilder
                selectedDishIds={event!.dishes}
                basedOnTemplate={event!.based_on_template}
                courses={event!.courses || []}
                dishCourses={event!.dish_courses || {}}
                menuChoices={event!.menu_choices || {}}
                guestsChoose={guestsChoose(event!.service_style, serviceStylesData)}
                serviceStyleLabel={serviceStyleLabels[event!.service_style]}
                pricePerHead={formPricePerHead}
                onPricePerHeadChange={undefined}
                guestCount={event!.guest_count}
                currencySymbol={settings.currency_symbol}
                disabled={true}
              />
            )}
            {editing && (
              /* Per-segment rates sit beside the Price/head they derive from, not in
                 the Guests card which is filled in before pricing (REL-428). */
              <SegmentRatesField
                segmentPrices={formSegmentPrices}
                onChange={(patch) => setFormSegmentPrices(patch.segment_prices)}
                pricePerHead={formPricePerHead}
                currencySymbol={settings.currency_symbol}
              />
            )}
        </CardContent>
      </Card>

      {/* Final numbers — the guarantee + per-entrée tallies, and the only place the
          two are checked against each other (REL-419). Confirmed onwards: nothing to
          guarantee before the booking is on, and the recorded numbers must stay on
          screen through the event day (an event auto-advances to in_progress then).
          Hidden while the form is being edited — saving the panel refetches the
          event, which would discard the unsaved edit above it. */}
      {!isNew && !editing && event && FINALS_STATUSES.includes(event.status) && (
        <FinalNumbersPanel
          event={event}
          dateFormat={dateFormat}
          onSaved={() => mutateEvent()}
        />
      )}


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
        guestCount={editing ? formGuestCount : (event!.guest_count || 0)}
        segmentCounts={editing ? formSegmentCounts : Object.fromEntries((event!.guest_counts ?? []).map((r) => [r.segment, r.count]))}
        segmentMeta={segmentMeta}
      />

      {/* Timeline Section — below the meals: the run-of-show is built around the
          meal times, so it reads after you've said what's being served (REL-430). */}
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
                entries={formTimeline}
                onEntriesChange={setFormTimeline}
                presets={timelinePresets}
                meals={timelineMealRows(formAdditionalMeals)}
              />
            ) : (
              /* Shared with the quote page (REL-447) — extracted, not copied, so the
                 two can't drift apart again. Same three fallbacks as before. */
              <BookingTimelineView
                entries={event!.timeline_entries}
                meals={timelineMealRows(event!.additional_meals)}
                eventDate={event!.date}
                setupTime={event!.setup_time}
                guestArrivalTime={event!.guest_arrival_time}
                mealTime={event!.meal_time}
                endTime={event!.end_time}
                dateFormat={dateFormat}
                timeFormat={timeFormat}
              />
            )}
        </CardContent>
      </Card>

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
        const viewSegmentCounts = Object.fromEntries((event?.guest_counts ?? []).map((r) => [r.segment, r.count]));
        const viewSegmentPrices = Object.fromEntries((event?.guest_counts ?? []).filter((r) => r.price_per_head != null).map((r) => [r.segment, String(r.price_per_head)]));
        const segCounts = editing ? formSegmentCounts : viewSegmentCounts;
        const segPrices = editing ? formSegmentPrices : viewSegmentPrices;
        const foodTotal = segmentFood(pph, guests, segCounts, segmentMeta, segPrices);
        const meals = editing ? formAdditionalMeals : (event?.additional_meals || []);
        // Audience-scoped meals price by their derived count (mirror of the backend).
        const mealsTotal = mealsFood(meals, guests, segCounts, segmentMeta);
        const mealRows = bookingMealRows(meals, settings.currency_symbol, guests, segCounts, segmentMeta);
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
            foodRows={segmentFoodRows(pph, guests, segCounts, segmentMeta, segPrices)}
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
            taxPercent={formatPercent(taxRate * 100)}
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
