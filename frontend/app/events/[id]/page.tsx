"use client";

import { useEffect, useState, useCallback } from "react";
import { useParams, useRouter } from "next/navigation";
import Link from "next/link";
import {
  api,
  EventData,
  Account,
  Venue,
  Contact,
  LaborRole,
  StaffMember,
  EquipmentItem,
  SiteSettingsData,
} from "@/lib/api";
import MenuBuilder from "@/components/MenuBuilder";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";

const statusBadgeVariant: Record<string, "warning" | "info" | "secondary" | "success" | "destructive"> = {
  tentative: "warning",
  confirmed: "info",
  in_progress: "secondary",
  completed: "success",
  cancelled: "destructive",
};

const eventTypeLabels: Record<string, string> = {
  wedding: "Wedding",
  corporate: "Corporate Event",
  birthday: "Birthday Party",
  funeral: "Funeral / Wake",
  religious: "Religious Event",
  social: "Social Gathering",
  other: "Other",
};

const serviceStyleLabels: Record<string, string> = {
  buffet: "Buffet",
  plated: "Plated / Sit-down",
  stations: "Food Stations",
  family_style: "Family Style",
  boxed: "Boxed / Individual",
  canapes: "Canap\u00e9s",
  mixed: "Mixed Service",
};

function ChevronIcon({ open }: { open: boolean }) {
  return (
    <svg
      className={`w-5 h-5 text-muted-foreground transition-transform ${open ? "rotate-90" : ""}`}
      fill="none"
      viewBox="0 0 24 24"
      stroke="currentColor"
      strokeWidth={2}
    >
      <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
    </svg>
  );
}

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
  const eventId = Number(params.id);

  // Core state
  const [event, setEvent] = useState<EventData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [editing, setEditing] = useState(false);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);

  // Lookup data
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [venues, setVenues] = useState<Venue[]>([]);
  const [laborRoles, setLaborRoles] = useState<LaborRole[]>([]);
  const [staffList, setStaffList] = useState<StaffMember[]>([]);
  const [equipmentItems, setEquipmentItems] = useState<EquipmentItem[]>([]);
  const [settings, setSettings] = useState<SiteSettingsData>({ currency_symbol: "\u00A3", currency_code: "GBP", default_price_per_head: "0.00", target_food_cost_percentage: "30.00", price_rounding_step: "50" });

  // Section collapse
  const [sections, setSections] = useState({
    customer: true,
    menu: true,
    guests: true,
    timeline: true,
    staffing: true,
    equipment: true,
    invoices: true,
  });

  // Venue mode
  const [venueMode, setVenueMode] = useState<"saved" | "custom">("saved");

  // Form fields (used in edit mode)
  const [formName, setFormName] = useState("");
  const [formDate, setFormDate] = useState("");
  const [formAccount, setFormAccount] = useState<number | null>(null);
  const [formContact, setFormContact] = useState<number | null>(null);
  const [formVenue, setFormVenue] = useState<number | null>(null);
  const [formVenueAddress, setFormVenueAddress] = useState("");
  const [formEventType, setFormEventType] = useState("");
  const [formServiceStyle, setFormServiceStyle] = useState("");
  const [formPricePerHead, setFormPricePerHead] = useState("");
  const [suggestedPrice, setSuggestedPrice] = useState<number | null>(null);
  const handleSuggestedPriceChange = useCallback((price: number | null) => setSuggestedPrice(price), []);
  const [formNotes, setFormNotes] = useState("");

  // Guest form fields
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

  // Equipment add form
  const [newEquipId, setNewEquipId] = useState<number | "">("");
  const [newEquipQty, setNewEquipQty] = useState(1);

  const toggleSection = (key: keyof typeof sections) => {
    setSections((prev) => ({ ...prev, [key]: !prev[key] }));
  };

  const syncFormToEvent = useCallback((data: EventData) => {
    setFormName(data.name);
    setFormDate(data.date);
    setFormAccount(data.account);
    setFormContact(data.primary_contact);
    setFormVenue(data.venue);
    setFormVenueAddress(data.venue_address || "");
    setFormEventType(data.event_type || "");
    setFormServiceStyle(data.service_style || "");
    setFormPricePerHead(data.price_per_head || "");
    setFormNotes(data.notes || "");
    setVenueMode(data.venue ? "saved" : data.venue_address ? "custom" : "saved");
    setFormGents(data.gents);
    setFormLadies(data.ladies);
    setFormGuaranteed(data.guaranteed_count);
    setFormFinalCount(data.final_count);
    setFormFinalCountDue(data.final_count_due || "");
    setFormBigEaters(data.big_eaters);
    setFormBigEatersPercent(data.big_eaters_percentage);
    setFormSetupTime(data.setup_time ? data.setup_time.slice(0, 16) : "");
    setFormArrivalTime(data.guest_arrival_time ? data.guest_arrival_time.slice(0, 16) : "");
    setFormMealTime(data.meal_time ? data.meal_time.slice(0, 16) : "");
    setFormEndTime(data.end_time ? data.end_time.slice(0, 16) : "");
  }, []);

  const refreshEvent = useCallback(async () => {
    try {
      const data = await api.getEvent(eventId);
      setEvent(data);
      syncFormToEvent(data);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Failed to load event");
    }
  }, [eventId, syncFormToEvent]);

  useEffect(() => {
    if (isNaN(eventId)) return;
    setLoading(true);
    Promise.all([
      refreshEvent(),
      api.getAccounts().then(setAccounts).catch(() => {}),
      api.getVenues().then(setVenues).catch(() => {}),
      api.getLaborRoles().then(setLaborRoles).catch(() => {}),
      api.getStaff().then(setStaffList).catch(() => {}),
      api.getEquipment().then(setEquipmentItems).catch(() => {}),
      api.getSiteSettings().then(setSettings).catch(() => {}),
    ]).finally(() => setLoading(false));
  }, [eventId, refreshEvent]);

  const handleSaveAll = async () => {
    if (!event) return;
    setSaving(true);
    try {
      const updated = await api.updateEvent(event.id, {
        name: formName,
        date: formDate,
        account: formAccount,
        primary_contact: formContact,
        venue: venueMode === "saved" ? formVenue : null,
        venue_address: venueMode === "custom" ? formVenueAddress : "",
        event_type: formEventType,
        service_style: formServiceStyle,
        price_per_head: formPricePerHead || null,
        notes: formNotes,
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
      } as Partial<EventData>);
      setEvent(updated);
      syncFormToEvent(updated);
      setEditing(false);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Save failed");
    } finally {
      setSaving(false);
    }
  };

  const handleCancelEdit = () => {
    if (event) syncFormToEvent(event);
    setEditing(false);
  };

  const handleStatusTransition = async (newStatus: string) => {
    if (!event) return;
    setSaving(true);
    try {
      const updated = await api.updateEvent(event.id, { status: newStatus } as Partial<EventData>);
      setEvent(updated);
      syncFormToEvent(updated);
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
      const updated = await api.updateEvent(event.id, {
        dish_ids: data.dish_ids,
        based_on_template: data.based_on_template,
      });
      setEvent(updated);
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
      await refreshEvent();
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
      await refreshEvent();
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Failed to delete shift");
    } finally {
      setSaving(false);
    }
  };

  const handleAddEquipment = async () => {
    if (!event || newEquipId === "") return;
    setSaving(true);
    try {
      await api.createReservation({
        event: event.id,
        equipment: newEquipId as number,
        quantity_out: newEquipQty,
      });
      setNewEquipId("");
      setNewEquipQty(1);
      await refreshEvent();
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Failed to add equipment");
    } finally {
      setSaving(false);
    }
  };

  const handleDeleteReservation = async (id: number) => {
    setSaving(true);
    try {
      await api.deleteReservation(id);
      await refreshEvent();
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Failed to delete reservation");
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
        subtotal: "0.00",
        tax_rate: "0.2000",
        tax_amount: "0.00",
        total: "0.00",
      });
      await refreshEvent();
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Failed to create invoice");
    } finally {
      setSaving(false);
    }
  };

  // Contacts for selected account
  const selectedAccount = accounts.find((a) => a.id === (editing ? formAccount : event?.account));
  const contactsForAccount: Contact[] = selectedAccount?.contacts || [];

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20">
        <p className="text-muted-foreground">Loading event...</p>
      </div>
    );
  }

  if (!event) {
    return (
      <div className="flex items-center justify-center py-20">
        <p className="text-destructive">{error || "Event not found"}</p>
      </div>
    );
  }

  const totalLaborCost = event.shifts.reduce(
    (sum, s) => sum + parseFloat(s.shift_cost || "0"),
    0
  );

  const totalEquipmentCost = event.equipment_reservations.reduce(
    (sum, r) => sum + parseFloat(r.line_cost || "0"),
    0
  );

  const formatDateTime = (dt: string | null) => {
    if (!dt) return "\u2014";
    return new Date(dt).toLocaleString();
  };

  return (
    <div className="space-y-6 max-w-5xl mx-auto">
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
        <CardContent className="pt-5 pb-5">
          <div className="flex items-start justify-between gap-4">
            <div className="flex items-center gap-3 flex-1 min-w-0">
              {editing ? (
                <Input
                  type="text"
                  value={formName}
                  onChange={(e) => setFormName(e.target.value)}
                  className="text-2xl font-bold h-auto py-1 max-w-md"
                />
              ) : (
                <h1 className="text-2xl font-bold text-foreground truncate">
                  {event.name}
                </h1>
              )}
              {editing ? (
                <Input
                  type="date"
                  value={formDate}
                  onChange={(e) => setFormDate(e.target.value)}
                  className="w-auto"
                />
              ) : (
                <span className="text-muted-foreground text-sm whitespace-nowrap">{event.date}</span>
              )}
              <Badge variant={statusBadgeVariant[event.status] || "secondary"} className="whitespace-nowrap">
                {event.status_display || event.status}
              </Badge>
            </div>
            <div className="flex gap-2 flex-shrink-0">
              {editing ? (
                <>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={handleCancelEdit}
                  >
                    Discard
                  </Button>
                  <Button
                    size="sm"
                    onClick={handleSaveAll}
                    disabled={saving}
                  >
                    {saving ? "Saving..." : "Save"}
                  </Button>
                </>
              ) : (
                <>
                  <Button
                    size="sm"
                    onClick={() => setEditing(true)}
                  >
                    Edit
                  </Button>
                  {/* Status transitions */}
                  {event.status === "tentative" && (
                    <Button
                      variant="success"
                      size="sm"
                      onClick={() => handleStatusTransition("confirmed")}
                      disabled={saving}
                    >
                      Confirm
                    </Button>
                  )}
                  {event.status === "confirmed" && (
                    <Button
                      variant="warning"
                      size="sm"
                      onClick={() => handleStatusTransition("in_progress")}
                      disabled={saving}
                    >
                      Start
                    </Button>
                  )}
                  {event.status === "in_progress" && (
                    <Button
                      variant="success"
                      size="sm"
                      onClick={() => handleStatusTransition("completed")}
                      disabled={saving}
                    >
                      Complete
                    </Button>
                  )}
                  {event.status === "cancelled" && (
                    <Button
                      variant="warning"
                      size="sm"
                      onClick={() => handleStatusTransition("tentative")}
                      disabled={saving}
                    >
                      Reactivate
                    </Button>
                  )}
                  {(event.status === "tentative" ||
                    event.status === "confirmed" ||
                    event.status === "in_progress") && (
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
                    onClick={() => setShowDeleteConfirm(true)}
                  >
                    Delete
                  </Button>
                  {event.source_quote_id && (
                    <Button variant="link" size="sm" asChild>
                      <Link href={`/quotes/${event.source_quote_id}`}>
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
      {showDeleteConfirm && (
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
        <button
          onClick={() => toggleSection("customer")}
          className="w-full flex items-center justify-between p-5 text-left"
        >
          <h2 className="text-lg font-semibold text-foreground">Customer &amp; Venue</h2>
          <ChevronIcon open={sections.customer} />
        </button>
        {sections.customer && (
          <div className="px-5 pb-5 border-t border-border pt-4">
            {editing ? (
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-foreground mb-1">Account</label>
                  <select
                    value={formAccount ?? ""}
                    onChange={(e) => {
                      const val = e.target.value ? Number(e.target.value) : null;
                      setFormAccount(val);
                      setFormContact(null);
                    }}
                    className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                  >
                    <option value="">-- No Account --</option>
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
                  <label className="block text-sm font-medium text-foreground mb-1">
                    Price Per Head ({settings.currency_symbol})
                  </label>
                  <div className="flex gap-2">
                    <Input
                      type="number"
                      step="0.01"
                      min="0"
                      value={formPricePerHead}
                      onChange={(e) => setFormPricePerHead(e.target.value)}
                      placeholder="0.00"
                    />
                    {suggestedPrice !== null && (
                      <Button
                        type="button"
                        variant="outline"
                        onClick={() => setFormPricePerHead(suggestedPrice.toFixed(2))}
                        className="whitespace-nowrap border-success/30 text-success bg-success/10 hover:bg-success/15"
                      >
                        Use {settings.currency_symbol}{suggestedPrice.toFixed(2)}
                      </Button>
                    )}
                  </div>
                </div>
                <div>
                  <label className="block text-sm font-medium text-foreground mb-1">Notes</label>
                  <Textarea
                    value={formNotes}
                    onChange={(e) => setFormNotes(e.target.value)}
                    rows={2}
                  />
                </div>
              </div>
            ) : (
              <dl className="grid grid-cols-2 md:grid-cols-3 gap-4">
                <InfoRow label="Account" value={event.account_name} />
                <InfoRow label="Primary Contact" value={event.contact_name} />
                <InfoRow label="Venue" value={event.venue_name || event.venue_address || null} />
                <InfoRow label="Event Type" value={eventTypeLabels[event.event_type] || event.event_type} />
                <InfoRow label="Service Style" value={serviceStyleLabels[event.service_style] || event.service_style} />
                <InfoRow label="Price Per Head" value={event.price_per_head ? `${settings.currency_symbol}${event.price_per_head}` : null} />
                {event.notes && <div className="col-span-full"><InfoRow label="Notes" value={event.notes} /></div>}
              </dl>
            )}
          </div>
        )}
      </Card>

      {/* Menu Section */}
      <Card>
        <button
          onClick={() => toggleSection("menu")}
          className="w-full flex items-center justify-between p-5 text-left"
        >
          <h2 className="text-lg font-semibold text-foreground">Menu</h2>
          <ChevronIcon open={sections.menu} />
        </button>
        {sections.menu && (
          <div className="px-5 pb-5 border-t border-border pt-4">
            <MenuBuilder
              selectedDishIds={event.dishes}
              basedOnTemplate={event.based_on_template}
              onSave={handleMenuSave}
              onSuggestedPriceChange={handleSuggestedPriceChange}
              onUseSuggestedPrice={(price) => setFormPricePerHead(price.toFixed(2))}
              currencySymbol={settings.currency_symbol}
            />
          </div>
        )}
      </Card>

      {/* Guest Counts Section */}
      <Card>
        <button
          onClick={() => toggleSection("guests")}
          className="w-full flex items-center justify-between p-5 text-left"
        >
          <h2 className="text-lg font-semibold text-foreground">Guest Counts</h2>
          <ChevronIcon open={sections.guests} />
        </button>
        {sections.guests && (
          <div className="px-5 pb-5 border-t border-border pt-4">
            {editing ? (
              <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
                <div>
                  <label className="block text-sm font-medium text-foreground mb-1">Gents</label>
                  <Input type="number" min={0} value={formGents} onChange={(e) => setFormGents(Number(e.target.value))} />
                </div>
                <div>
                  <label className="block text-sm font-medium text-foreground mb-1">Ladies</label>
                  <Input type="number" min={0} value={formLadies} onChange={(e) => setFormLadies(Number(e.target.value))} />
                </div>
                <div>
                  <label className="block text-sm font-medium text-foreground mb-1">Guaranteed Count</label>
                  <Input type="number" min={0} value={formGuaranteed ?? ""} onChange={(e) => setFormGuaranteed(e.target.value ? Number(e.target.value) : null)} />
                </div>
                <div>
                  <label className="block text-sm font-medium text-foreground mb-1">Final Count</label>
                  <Input type="number" min={0} value={formFinalCount ?? ""} onChange={(e) => setFormFinalCount(e.target.value ? Number(e.target.value) : null)} />
                </div>
                <div>
                  <label className="block text-sm font-medium text-foreground mb-1">Final Count Due</label>
                  <Input type="date" value={formFinalCountDue} onChange={(e) => setFormFinalCountDue(e.target.value)} />
                </div>
                <div className="flex flex-col justify-end">
                  <label className="flex items-center gap-2 text-sm">
                    <input type="checkbox" checked={formBigEaters} onChange={(e) => setFormBigEaters(e.target.checked)} className="rounded border-input text-primary focus:ring-ring" />
                    <span className="font-medium text-foreground">Big Eaters</span>
                  </label>
                  {formBigEaters && (
                    <div className="mt-2">
                      <label className="block text-xs text-muted-foreground mb-0.5">Percentage (%)</label>
                      <Input type="number" min={0} max={100} value={formBigEatersPercent} onChange={(e) => setFormBigEatersPercent(Number(e.target.value))} className="h-8" />
                    </div>
                  )}
                </div>
              </div>
            ) : (
              <dl className="grid grid-cols-2 md:grid-cols-3 gap-4">
                <InfoRow label="Gents" value={event.gents} />
                <InfoRow label="Ladies" value={event.ladies} />
                <InfoRow label="Total" value={event.gents + event.ladies} />
                <InfoRow label="Guaranteed Count" value={event.guaranteed_count} />
                <InfoRow label="Final Count" value={event.final_count} />
                <InfoRow label="Final Count Due" value={event.final_count_due} />
                <InfoRow label="Big Eaters" value={event.big_eaters ? `Yes (+${event.big_eaters_percentage}%)` : "No"} />
              </dl>
            )}
          </div>
        )}
      </Card>

      {/* Timeline Section */}
      <Card>
        <button
          onClick={() => toggleSection("timeline")}
          className="w-full flex items-center justify-between p-5 text-left"
        >
          <h2 className="text-lg font-semibold text-foreground">Timeline</h2>
          <ChevronIcon open={sections.timeline} />
        </button>
        {sections.timeline && (
          <div className="px-5 pb-5 border-t border-border pt-4">
            {editing ? (
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-foreground mb-1">Setup Time</label>
                  <Input type="datetime-local" value={formSetupTime} onChange={(e) => setFormSetupTime(e.target.value)} />
                </div>
                <div>
                  <label className="block text-sm font-medium text-foreground mb-1">Guest Arrival Time</label>
                  <Input type="datetime-local" value={formArrivalTime} onChange={(e) => setFormArrivalTime(e.target.value)} />
                </div>
                <div>
                  <label className="block text-sm font-medium text-foreground mb-1">Meal Time</label>
                  <Input type="datetime-local" value={formMealTime} onChange={(e) => setFormMealTime(e.target.value)} />
                </div>
                <div>
                  <label className="block text-sm font-medium text-foreground mb-1">End Time</label>
                  <Input type="datetime-local" value={formEndTime} onChange={(e) => setFormEndTime(e.target.value)} />
                </div>
              </div>
            ) : (
              <dl className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <InfoRow label="Setup Time" value={formatDateTime(event.setup_time)} />
                <InfoRow label="Guest Arrival" value={formatDateTime(event.guest_arrival_time)} />
                <InfoRow label="Meal Time" value={formatDateTime(event.meal_time)} />
                <InfoRow label="End Time" value={formatDateTime(event.end_time)} />
              </dl>
            )}
          </div>
        )}
      </Card>

      {/* Staffing Section */}
      <Card>
        <button
          onClick={() => toggleSection("staffing")}
          className="w-full flex items-center justify-between p-5 text-left"
        >
          <h2 className="text-lg font-semibold text-foreground">Staffing</h2>
          <ChevronIcon open={sections.staffing} />
        </button>
        {sections.staffing && (
          <div className="px-5 pb-5 border-t border-border pt-4">
            {event.shifts.length > 0 ? (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="bg-muted border-b border-border">
                    <tr>
                      <th className="text-left px-3 py-2 font-medium text-muted-foreground">Role</th>
                      <th className="text-left px-3 py-2 font-medium text-muted-foreground">Staff</th>
                      <th className="text-left px-3 py-2 font-medium text-muted-foreground">Start</th>
                      <th className="text-left px-3 py-2 font-medium text-muted-foreground">End</th>
                      <th className="text-right px-3 py-2 font-medium text-muted-foreground">Cost</th>
                      <th className="text-center px-3 py-2 font-medium text-muted-foreground">Status</th>
                      <th className="px-3 py-2"></th>
                    </tr>
                  </thead>
                  <tbody>
                    {event.shifts.map((shift) => (
                      <tr key={shift.id} className="border-b border-border hover:bg-muted">
                        <td className="px-3 py-2 text-foreground">{shift.role_name}</td>
                        <td className="px-3 py-2 text-foreground">{shift.staff_member_name || "Unassigned"}</td>
                        <td className="px-3 py-2 text-muted-foreground text-xs">{formatDateTime(shift.start_time)}</td>
                        <td className="px-3 py-2 text-muted-foreground text-xs">{formatDateTime(shift.end_time)}</td>
                        <td className="px-3 py-2 text-right text-foreground">{parseFloat(shift.shift_cost).toFixed(2)}</td>
                        <td className="px-3 py-2 text-center">
                          <Badge variant="secondary">{shift.status}</Badge>
                        </td>
                        <td className="px-3 py-2 text-center">
                          <Button variant="ghost" size="sm" onClick={() => handleDeleteShift(shift.id)} disabled={saving} className="text-destructive hover:text-destructive" title="Delete shift">X</Button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                  <tfoot className="bg-muted border-t border-border">
                    <tr className="font-semibold">
                      <td colSpan={4} className="px-3 py-2 text-foreground">Total Labor Cost</td>
                      <td className="px-3 py-2 text-right text-foreground">{totalLaborCost.toFixed(2)}</td>
                      <td colSpan={2}></td>
                    </tr>
                  </tfoot>
                </table>
              </div>
            ) : (
              <p className="text-sm text-muted-foreground mb-4">No shifts scheduled yet.</p>
            )}

            {/* Add Shift Form */}
            <div className="mt-4 p-3 bg-muted rounded-lg border border-border">
              <p className="text-sm font-medium text-foreground mb-2">Add Shift</p>
              <div className="grid grid-cols-2 md:grid-cols-5 gap-2">
                <select value={newShiftRole} onChange={(e) => setNewShiftRole(e.target.value ? Number(e.target.value) : "")} className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring">
                  <option value="">Role...</option>
                  {laborRoles.map((r) => (<option key={r.id} value={r.id}>{r.name}</option>))}
                </select>
                <select value={newShiftStaff} onChange={(e) => setNewShiftStaff(e.target.value ? Number(e.target.value) : "")} className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring">
                  <option value="">Staff (optional)...</option>
                  {staffList.map((s) => (<option key={s.id} value={s.id}>{s.name}</option>))}
                </select>
                <Input type="datetime-local" value={newShiftStart} onChange={(e) => setNewShiftStart(e.target.value)} placeholder="Start" />
                <Input type="datetime-local" value={newShiftEnd} onChange={(e) => setNewShiftEnd(e.target.value)} placeholder="End" />
                <Button size="sm" onClick={handleAddShift} disabled={saving || newShiftRole === "" || !newShiftStart || !newShiftEnd}>
                  Add
                </Button>
              </div>
            </div>
          </div>
        )}
      </Card>

      {/* Equipment Section */}
      <Card>
        <button
          onClick={() => toggleSection("equipment")}
          className="w-full flex items-center justify-between p-5 text-left"
        >
          <h2 className="text-lg font-semibold text-foreground">Equipment</h2>
          <ChevronIcon open={sections.equipment} />
        </button>
        {sections.equipment && (
          <div className="px-5 pb-5 border-t border-border pt-4">
            {event.equipment_reservations.length > 0 ? (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="bg-muted border-b border-border">
                    <tr>
                      <th className="text-left px-3 py-2 font-medium text-muted-foreground">Equipment</th>
                      <th className="text-right px-3 py-2 font-medium text-muted-foreground">Qty</th>
                      <th className="text-right px-3 py-2 font-medium text-muted-foreground">Cost</th>
                      <th className="px-3 py-2"></th>
                    </tr>
                  </thead>
                  <tbody>
                    {event.equipment_reservations.map((res) => (
                      <tr key={res.id} className="border-b border-border hover:bg-muted">
                        <td className="px-3 py-2 text-foreground">{res.equipment_name}</td>
                        <td className="px-3 py-2 text-right text-foreground">{res.quantity_out}</td>
                        <td className="px-3 py-2 text-right text-foreground">{parseFloat(res.line_cost).toFixed(2)}</td>
                        <td className="px-3 py-2 text-center">
                          <Button variant="ghost" size="sm" onClick={() => handleDeleteReservation(res.id)} disabled={saving} className="text-destructive hover:text-destructive" title="Delete reservation">X</Button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                  <tfoot className="bg-muted border-t border-border">
                    <tr className="font-semibold">
                      <td colSpan={2} className="px-3 py-2 text-foreground">Total Equipment Cost</td>
                      <td className="px-3 py-2 text-right text-foreground">{totalEquipmentCost.toFixed(2)}</td>
                      <td></td>
                    </tr>
                  </tfoot>
                </table>
              </div>
            ) : (
              <p className="text-sm text-muted-foreground mb-4">No equipment reserved yet.</p>
            )}

            {/* Add Equipment Form */}
            <div className="mt-4 p-3 bg-muted rounded-lg border border-border">
              <p className="text-sm font-medium text-foreground mb-2">Add Equipment</p>
              <div className="grid grid-cols-3 gap-2">
                <select value={newEquipId} onChange={(e) => setNewEquipId(e.target.value ? Number(e.target.value) : "")} className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring">
                  <option value="">Equipment...</option>
                  {equipmentItems.map((eq) => (<option key={eq.id} value={eq.id}>{eq.name}</option>))}
                </select>
                <Input type="number" min={1} value={newEquipQty} onChange={(e) => setNewEquipQty(Number(e.target.value))} placeholder="Quantity" />
                <Button size="sm" onClick={handleAddEquipment} disabled={saving || newEquipId === ""}>Add</Button>
              </div>
            </div>
          </div>
        )}
      </Card>

      {/* Invoices Section */}
      <Card>
        <button
          onClick={() => toggleSection("invoices")}
          className="w-full flex items-center justify-between p-5 text-left"
        >
          <h2 className="text-lg font-semibold text-foreground">Invoices</h2>
          <ChevronIcon open={sections.invoices} />
        </button>
        {sections.invoices && (
          <div className="px-5 pb-5 border-t border-border pt-4">
            {event.invoices.length > 0 ? (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="bg-muted border-b border-border">
                    <tr>
                      <th className="text-left px-3 py-2 font-medium text-muted-foreground">Invoice #</th>
                      <th className="text-left px-3 py-2 font-medium text-muted-foreground">Type</th>
                      <th className="text-right px-3 py-2 font-medium text-muted-foreground">Total</th>
                      <th className="text-center px-3 py-2 font-medium text-muted-foreground">Status</th>
                      <th className="text-right px-3 py-2 font-medium text-muted-foreground">Balance Due</th>
                    </tr>
                  </thead>
                  <tbody>
                    {event.invoices.map((inv) => (
                      <tr key={inv.id} className="border-b border-border hover:bg-muted">
                        <td className="px-3 py-2">
                          <Link href={`/invoices/${inv.id}`} className="text-primary hover:text-primary/80 font-medium">{inv.invoice_number}</Link>
                        </td>
                        <td className="px-3 py-2 text-muted-foreground capitalize">{inv.invoice_type}</td>
                        <td className="px-3 py-2 text-right text-foreground">{parseFloat(inv.total).toFixed(2)}</td>
                        <td className="px-3 py-2 text-center">
                          <Badge variant={
                            inv.status === "paid" ? "success" :
                            inv.status === "overdue" ? "destructive" :
                            inv.status === "sent" ? "info" :
                            "secondary"
                          }>{inv.status}</Badge>
                        </td>
                        <td className="px-3 py-2 text-right text-foreground">{parseFloat(inv.balance_due).toFixed(2)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <p className="text-sm text-muted-foreground mb-4">No invoices yet.</p>
            )}

            <div className="mt-4">
              <Button
                onClick={handleCreateInvoice}
                disabled={saving}
              >
                {saving ? "Creating..." : "Create Invoice"}
              </Button>
            </div>
          </div>
        )}
      </Card>
    </div>
  );
}
