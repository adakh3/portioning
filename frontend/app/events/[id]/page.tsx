"use client";

import { useEffect, useState, useCallback } from "react";
import { useParams } from "next/navigation";
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

const statusColors: Record<string, string> = {
  tentative: "bg-yellow-100 text-yellow-800",
  confirmed: "bg-blue-100 text-blue-800",
  in_progress: "bg-orange-100 text-orange-800",
  completed: "bg-green-100 text-green-800",
  cancelled: "bg-red-100 text-red-800",
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
      className={`w-5 h-5 text-gray-500 transition-transform ${open ? "rotate-90" : ""}`}
      fill="none"
      viewBox="0 0 24 24"
      stroke="currentColor"
      strokeWidth={2}
    >
      <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
    </svg>
  );
}

export default function EventDetailPage() {
  const params = useParams();
  const eventId = Number(params.id);

  // Core state
  const [event, setEvent] = useState<EventData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  // Lookup data
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [venues, setVenues] = useState<Venue[]>([]);
  const [laborRoles, setLaborRoles] = useState<LaborRole[]>([]);
  const [staffList, setStaffList] = useState<StaffMember[]>([]);
  const [equipmentItems, setEquipmentItems] = useState<EquipmentItem[]>([]);
  const [settings, setSettings] = useState<SiteSettingsData>({ currency_symbol: "£", currency_code: "GBP", default_price_per_head: "0.00" });

  // Inline name editing
  const [editingName, setEditingName] = useState(false);
  const [draftName, setDraftName] = useState("");

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

  // Customer & Venue form fields
  const [formAccount, setFormAccount] = useState<number | null>(null);
  const [formContact, setFormContact] = useState<number | null>(null);
  const [formVenue, setFormVenue] = useState<number | null>(null);
  const [formVenueAddress, setFormVenueAddress] = useState("");
  const [formEventType, setFormEventType] = useState("");
  const [formServiceStyle, setFormServiceStyle] = useState("");
  const [formPricePerHead, setFormPricePerHead] = useState("");

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

  const refreshEvent = useCallback(async () => {
    try {
      const data = await api.getEvent(eventId);
      setEvent(data);
      // Sync form state
      setDraftName(data.name);
      setFormAccount(data.account);
      setFormContact(data.primary_contact);
      setFormVenue(data.venue);
      setFormVenueAddress(data.venue_address || "");
      setFormEventType(data.event_type || "");
      setFormServiceStyle(data.service_style || "");
      setFormPricePerHead(data.price_per_head || "");
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
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Failed to load event");
    }
  }, [eventId]);

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

  const saveField = async (data: Partial<EventData> & { dish_ids?: number[] }) => {
    if (!event) return;
    setSaving(true);
    try {
      const updated = await api.updateEvent(event.id, data);
      setEvent(updated);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Save failed");
    } finally {
      setSaving(false);
    }
  };

  const handleStatusTransition = async (newStatus: string) => {
    await saveField({ status: newStatus } as Partial<EventData>);
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
  const selectedAccount = accounts.find((a) => a.id === formAccount);
  const contactsForAccount: Contact[] = selectedAccount?.contacts || [];

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20">
        <p className="text-gray-500">Loading event...</p>
      </div>
    );
  }

  if (!event) {
    return (
      <div className="flex items-center justify-center py-20">
        <p className="text-red-600">{error || "Event not found"}</p>
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

  return (
    <div className="space-y-6 max-w-5xl mx-auto">
      {/* Error banner */}
      {error && (
        <div className="bg-red-50 border border-red-200 rounded-lg p-4 flex items-center justify-between">
          <p className="text-red-700 text-sm">{error}</p>
          <button
            onClick={() => setError(null)}
            className="text-red-400 hover:text-red-600 text-sm font-medium"
          >
            Dismiss
          </button>
        </div>
      )}

      {/* Header Section */}
      <div className="bg-white border border-gray-200 rounded-lg p-5">
        <div className="flex items-start justify-between gap-4">
          <div className="flex items-center gap-3 flex-1 min-w-0">
            {editingName ? (
              <input
                type="text"
                value={draftName}
                onChange={(e) => setDraftName(e.target.value)}
                onBlur={() => {
                  setEditingName(false);
                  if (draftName.trim() && draftName !== event.name) {
                    saveField({ name: draftName.trim() });
                  }
                }}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    setEditingName(false);
                    if (draftName.trim() && draftName !== event.name) {
                      saveField({ name: draftName.trim() });
                    }
                  }
                  if (e.key === "Escape") {
                    setEditingName(false);
                    setDraftName(event.name);
                  }
                }}
                autoFocus
                className="text-2xl font-bold text-gray-900 border border-blue-400 rounded px-2 py-1 focus:outline-none focus:ring-2 focus:ring-blue-500 w-full"
              />
            ) : (
              <h1
                onClick={() => {
                  setDraftName(event.name);
                  setEditingName(true);
                }}
                className="text-2xl font-bold text-gray-900 cursor-pointer hover:bg-gray-50 rounded px-2 py-1 truncate"
                title="Click to edit name"
              >
                {event.name}
              </h1>
            )}
            <span className="text-gray-500 text-sm whitespace-nowrap">{event.date}</span>
            <span
              className={`inline-block px-2.5 py-0.5 rounded-full text-xs font-medium whitespace-nowrap ${
                statusColors[event.status] || "bg-gray-100 text-gray-800"
              }`}
            >
              {event.status_display || event.status}
            </span>
          </div>
          <div className="flex gap-2 flex-shrink-0">
            {event.status === "tentative" && (
              <button
                onClick={() => handleStatusTransition("confirmed")}
                disabled={saving}
                className="bg-blue-600 text-white px-3 py-1.5 rounded text-sm font-medium hover:bg-blue-700 disabled:opacity-50"
              >
                Confirm
              </button>
            )}
            {event.status === "confirmed" && (
              <button
                onClick={() => handleStatusTransition("in_progress")}
                disabled={saving}
                className="bg-orange-600 text-white px-3 py-1.5 rounded text-sm font-medium hover:bg-orange-700 disabled:opacity-50"
              >
                Start
              </button>
            )}
            {event.status === "in_progress" && (
              <button
                onClick={() => handleStatusTransition("completed")}
                disabled={saving}
                className="bg-green-600 text-white px-3 py-1.5 rounded text-sm font-medium hover:bg-green-700 disabled:opacity-50"
              >
                Complete
              </button>
            )}
            {event.status === "cancelled" && (
              <button
                onClick={() => handleStatusTransition("tentative")}
                disabled={saving}
                className="bg-yellow-600 text-white px-3 py-1.5 rounded text-sm font-medium hover:bg-yellow-700 disabled:opacity-50"
              >
                Reactivate
              </button>
            )}
            {(event.status === "tentative" ||
              event.status === "confirmed" ||
              event.status === "in_progress") && (
              <button
                onClick={() => handleStatusTransition("cancelled")}
                disabled={saving}
                className="border border-red-300 text-red-700 bg-white px-3 py-1.5 rounded text-sm font-medium hover:bg-red-50 disabled:opacity-50"
              >
                Cancel
              </button>
            )}
            {event.source_quote_id && (
              <Link
                href={`/quotes/${event.source_quote_id}`}
                className="text-blue-600 hover:text-blue-800 text-sm font-medium whitespace-nowrap self-center"
              >
                View Quote &rarr;
              </Link>
            )}
          </div>
        </div>
      </div>

      {/* Customer & Venue Section */}
      <div className="bg-white border border-gray-200 rounded-lg">
        <button
          onClick={() => toggleSection("customer")}
          className="w-full flex items-center justify-between p-5 text-left"
        >
          <h2 className="text-lg font-semibold text-gray-900">Customer &amp; Venue</h2>
          <ChevronIcon open={sections.customer} />
        </button>
        {sections.customer && (
          <div className="px-5 pb-5 border-t border-gray-100 pt-4">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {/* Account */}
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Account</label>
                <select
                  value={formAccount ?? ""}
                  onChange={(e) => {
                    const val = e.target.value ? Number(e.target.value) : null;
                    setFormAccount(val);
                    setFormContact(null);
                  }}
                  className="w-full border border-gray-300 rounded-md px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                >
                  <option value="">-- No Account --</option>
                  {accounts.map((a) => (
                    <option key={a.id} value={a.id}>
                      {a.name}
                    </option>
                  ))}
                </select>
                {formAccount && (
                  <Link
                    href="/accounts"
                    className="text-xs text-blue-600 hover:text-blue-800 mt-1 inline-block"
                  >
                    View accounts
                  </Link>
                )}
              </div>

              {/* Contact */}
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Primary Contact
                </label>
                <select
                  value={formContact ?? ""}
                  onChange={(e) => {
                    setFormContact(e.target.value ? Number(e.target.value) : null);
                  }}
                  disabled={!formAccount}
                  className="w-full border border-gray-300 rounded-md px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:bg-gray-100 disabled:text-gray-400"
                >
                  <option value="">-- Select Contact --</option>
                  {contactsForAccount.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name} {c.role ? `(${c.role})` : ""}
                    </option>
                  ))}
                </select>
              </div>

              {/* Venue toggle */}
              <div className="md:col-span-2">
                <label className="block text-sm font-medium text-gray-700 mb-1">Venue</label>
                <div className="flex gap-4 mb-2">
                  <label className="flex items-center gap-1.5 text-sm">
                    <input
                      type="radio"
                      name="venueMode"
                      checked={venueMode === "saved"}
                      onChange={() => setVenueMode("saved")}
                      className="text-blue-600"
                    />
                    Saved Venue
                  </label>
                  <label className="flex items-center gap-1.5 text-sm">
                    <input
                      type="radio"
                      name="venueMode"
                      checked={venueMode === "custom"}
                      onChange={() => setVenueMode("custom")}
                      className="text-blue-600"
                    />
                    Custom Address
                  </label>
                </div>
                {venueMode === "saved" ? (
                  <select
                    value={formVenue ?? ""}
                    onChange={(e) => {
                      setFormVenue(e.target.value ? Number(e.target.value) : null);
                    }}
                    className="w-full border border-gray-300 rounded-md px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                  >
                    <option value="">-- Select Venue --</option>
                    {venues.map((v) => (
                      <option key={v.id} value={v.id}>
                        {v.name} - {v.city}
                      </option>
                    ))}
                  </select>
                ) : (
                  <textarea
                    value={formVenueAddress}
                    onChange={(e) => setFormVenueAddress(e.target.value)}
                    onBlur={() => {
                      if (formVenueAddress !== event.venue_address) {
                        saveField({ venue_address: formVenueAddress, venue: null } as Partial<EventData>);
                      }
                    }}
                    rows={3}
                    placeholder="Enter venue address..."
                    className="w-full border border-gray-300 rounded-md px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                  />
                )}
              </div>

              {/* Event Type */}
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Event Type</label>
                <select
                  value={formEventType}
                  onChange={(e) => setFormEventType(e.target.value)}
                  className="w-full border border-gray-300 rounded-md px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                >
                  <option value="">-- Select --</option>
                  {Object.entries(eventTypeLabels).map(([key, label]) => (
                    <option key={key} value={key}>
                      {label}
                    </option>
                  ))}
                </select>
              </div>

              {/* Service Style */}
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Service Style
                </label>
                <select
                  value={formServiceStyle}
                  onChange={(e) => setFormServiceStyle(e.target.value)}
                  className="w-full border border-gray-300 rounded-md px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                >
                  <option value="">-- Select --</option>
                  {Object.entries(serviceStyleLabels).map(([key, label]) => (
                    <option key={key} value={key}>
                      {label}
                    </option>
                  ))}
                </select>
              </div>

              {/* Price Per Head */}
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Price Per Head ({settings.currency_symbol})
                </label>
                <input
                  type="number"
                  step="0.01"
                  min="0"
                  value={formPricePerHead}
                  onChange={(e) => setFormPricePerHead(e.target.value)}
                  placeholder="0.00"
                  className="w-full border border-gray-300 rounded-md px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
                {formPricePerHead && event && (event.gents + event.ladies) > 0 && (
                  <p className="text-xs text-gray-500 mt-1">
                    Food total: {settings.currency_symbol}{(parseFloat(formPricePerHead) * (event.gents + event.ladies)).toFixed(2)} ({event.gents + event.ladies} guests)
                  </p>
                )}
              </div>
            </div>

            <div className="mt-4 flex justify-end">
              <button
                onClick={() =>
                  saveField({
                    account: formAccount,
                    primary_contact: formContact,
                    venue: venueMode === "saved" ? formVenue : null,
                    venue_address: venueMode === "custom" ? formVenueAddress : "",
                    event_type: formEventType,
                    service_style: formServiceStyle,
                    price_per_head: formPricePerHead || null,
                  } as Partial<EventData>)
                }
                disabled={saving}
                className="bg-blue-600 text-white px-4 py-2 rounded text-sm font-medium hover:bg-blue-700 disabled:opacity-50"
              >
                {saving ? "Saving..." : "Save"}
              </button>
            </div>
          </div>
        )}
      </div>

      {/* Menu Section */}
      <div className="bg-white border border-gray-200 rounded-lg">
        <button
          onClick={() => toggleSection("menu")}
          className="w-full flex items-center justify-between p-5 text-left"
        >
          <h2 className="text-lg font-semibold text-gray-900">Menu</h2>
          <ChevronIcon open={sections.menu} />
        </button>
        {sections.menu && (
          <div className="px-5 pb-5 border-t border-gray-100 pt-4">
            <MenuBuilder
              selectedDishIds={event.dishes}
              basedOnTemplate={event.based_on_template}
              onSave={async (data) => {
                await saveField({
                  dish_ids: data.dish_ids,
                  based_on_template: data.based_on_template,
                });
              }}
            />
          </div>
        )}
      </div>

      {/* Guest Counts Section */}
      <div className="bg-white border border-gray-200 rounded-lg">
        <button
          onClick={() => toggleSection("guests")}
          className="w-full flex items-center justify-between p-5 text-left"
        >
          <h2 className="text-lg font-semibold text-gray-900">Guest Counts</h2>
          <ChevronIcon open={sections.guests} />
        </button>
        {sections.guests && (
          <div className="px-5 pb-5 border-t border-gray-100 pt-4">
            <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Gents</label>
                <input
                  type="number"
                  min={0}
                  value={formGents}
                  onChange={(e) => setFormGents(Number(e.target.value))}
                  className="w-full border border-gray-300 rounded-md px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Ladies</label>
                <input
                  type="number"
                  min={0}
                  value={formLadies}
                  onChange={(e) => setFormLadies(Number(e.target.value))}
                  className="w-full border border-gray-300 rounded-md px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Guaranteed Count
                </label>
                <input
                  type="number"
                  min={0}
                  value={formGuaranteed ?? ""}
                  onChange={(e) =>
                    setFormGuaranteed(e.target.value ? Number(e.target.value) : null)
                  }
                  className="w-full border border-gray-300 rounded-md px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Final Count</label>
                <input
                  type="number"
                  min={0}
                  value={formFinalCount ?? ""}
                  onChange={(e) =>
                    setFormFinalCount(e.target.value ? Number(e.target.value) : null)
                  }
                  className="w-full border border-gray-300 rounded-md px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Final Count Due
                </label>
                <input
                  type="date"
                  value={formFinalCountDue}
                  onChange={(e) => setFormFinalCountDue(e.target.value)}
                  className="w-full border border-gray-300 rounded-md px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
              </div>
              <div className="flex flex-col justify-end">
                <label className="flex items-center gap-2 text-sm">
                  <input
                    type="checkbox"
                    checked={formBigEaters}
                    onChange={(e) => setFormBigEaters(e.target.checked)}
                    className="rounded border-gray-300 text-blue-600 focus:ring-blue-500"
                  />
                  <span className="font-medium text-gray-700">Big Eaters</span>
                </label>
                {formBigEaters && (
                  <div className="mt-2">
                    <label className="block text-xs text-gray-500 mb-0.5">Percentage (%)</label>
                    <input
                      type="number"
                      min={0}
                      max={100}
                      value={formBigEatersPercent}
                      onChange={(e) => setFormBigEatersPercent(Number(e.target.value))}
                      className="w-full border border-gray-300 rounded-md px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                    />
                  </div>
                )}
              </div>
            </div>
            <div className="mt-4 flex justify-end">
              <button
                onClick={() =>
                  saveField({
                    gents: formGents,
                    ladies: formLadies,
                    guaranteed_count: formGuaranteed,
                    final_count: formFinalCount,
                    final_count_due: formFinalCountDue || null,
                    big_eaters: formBigEaters,
                    big_eaters_percentage: formBigEatersPercent,
                  } as Partial<EventData>)
                }
                disabled={saving}
                className="bg-blue-600 text-white px-4 py-2 rounded text-sm font-medium hover:bg-blue-700 disabled:opacity-50"
              >
                {saving ? "Saving..." : "Save"}
              </button>
            </div>
          </div>
        )}
      </div>

      {/* Timeline Section */}
      <div className="bg-white border border-gray-200 rounded-lg">
        <button
          onClick={() => toggleSection("timeline")}
          className="w-full flex items-center justify-between p-5 text-left"
        >
          <h2 className="text-lg font-semibold text-gray-900">Timeline</h2>
          <ChevronIcon open={sections.timeline} />
        </button>
        {sections.timeline && (
          <div className="px-5 pb-5 border-t border-gray-100 pt-4">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Setup Time</label>
                <input
                  type="datetime-local"
                  value={formSetupTime}
                  onChange={(e) => setFormSetupTime(e.target.value)}
                  className="w-full border border-gray-300 rounded-md px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Guest Arrival Time
                </label>
                <input
                  type="datetime-local"
                  value={formArrivalTime}
                  onChange={(e) => setFormArrivalTime(e.target.value)}
                  className="w-full border border-gray-300 rounded-md px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Meal Time</label>
                <input
                  type="datetime-local"
                  value={formMealTime}
                  onChange={(e) => setFormMealTime(e.target.value)}
                  className="w-full border border-gray-300 rounded-md px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">End Time</label>
                <input
                  type="datetime-local"
                  value={formEndTime}
                  onChange={(e) => setFormEndTime(e.target.value)}
                  className="w-full border border-gray-300 rounded-md px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
              </div>
            </div>
            <div className="mt-4 flex justify-end">
              <button
                onClick={() =>
                  saveField({
                    setup_time: formSetupTime || null,
                    guest_arrival_time: formArrivalTime || null,
                    meal_time: formMealTime || null,
                    end_time: formEndTime || null,
                  } as Partial<EventData>)
                }
                disabled={saving}
                className="bg-blue-600 text-white px-4 py-2 rounded text-sm font-medium hover:bg-blue-700 disabled:opacity-50"
              >
                {saving ? "Saving..." : "Save"}
              </button>
            </div>
          </div>
        )}
      </div>

      {/* Staffing Section */}
      <div className="bg-white border border-gray-200 rounded-lg">
        <button
          onClick={() => toggleSection("staffing")}
          className="w-full flex items-center justify-between p-5 text-left"
        >
          <h2 className="text-lg font-semibold text-gray-900">Staffing</h2>
          <ChevronIcon open={sections.staffing} />
        </button>
        {sections.staffing && (
          <div className="px-5 pb-5 border-t border-gray-100 pt-4">
            {event.shifts.length > 0 ? (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="bg-gray-50 border-b border-gray-200">
                    <tr>
                      <th className="text-left px-3 py-2 font-medium text-gray-700">Role</th>
                      <th className="text-left px-3 py-2 font-medium text-gray-700">Staff</th>
                      <th className="text-left px-3 py-2 font-medium text-gray-700">Start</th>
                      <th className="text-left px-3 py-2 font-medium text-gray-700">End</th>
                      <th className="text-right px-3 py-2 font-medium text-gray-700">Cost</th>
                      <th className="text-center px-3 py-2 font-medium text-gray-700">Status</th>
                      <th className="px-3 py-2"></th>
                    </tr>
                  </thead>
                  <tbody>
                    {event.shifts.map((shift) => (
                      <tr key={shift.id} className="border-b border-gray-100 hover:bg-gray-50">
                        <td className="px-3 py-2 text-gray-900">{shift.role_name}</td>
                        <td className="px-3 py-2 text-gray-900">
                          {shift.staff_member_name || "Unassigned"}
                        </td>
                        <td className="px-3 py-2 text-gray-600 text-xs">
                          {shift.start_time ? new Date(shift.start_time).toLocaleString() : "-"}
                        </td>
                        <td className="px-3 py-2 text-gray-600 text-xs">
                          {shift.end_time ? new Date(shift.end_time).toLocaleString() : "-"}
                        </td>
                        <td className="px-3 py-2 text-right text-gray-900">
                          {parseFloat(shift.shift_cost).toFixed(2)}
                        </td>
                        <td className="px-3 py-2 text-center">
                          <span className="inline-block px-2 py-0.5 rounded-full text-xs font-medium bg-gray-100 text-gray-700">
                            {shift.status}
                          </span>
                        </td>
                        <td className="px-3 py-2 text-center">
                          <button
                            onClick={() => handleDeleteShift(shift.id)}
                            disabled={saving}
                            className="text-red-500 hover:text-red-700 text-sm font-medium disabled:opacity-50"
                            title="Delete shift"
                          >
                            X
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                  <tfoot className="bg-gray-50 border-t border-gray-300">
                    <tr className="font-semibold">
                      <td colSpan={4} className="px-3 py-2 text-gray-900">
                        Total Labor Cost
                      </td>
                      <td className="px-3 py-2 text-right text-gray-900">
                        {totalLaborCost.toFixed(2)}
                      </td>
                      <td colSpan={2}></td>
                    </tr>
                  </tfoot>
                </table>
              </div>
            ) : (
              <p className="text-sm text-gray-500 mb-4">No shifts scheduled yet.</p>
            )}

            {/* Add Shift Form */}
            <div className="mt-4 p-3 bg-gray-50 rounded-lg border border-gray-200">
              <p className="text-sm font-medium text-gray-700 mb-2">Add Shift</p>
              <div className="grid grid-cols-2 md:grid-cols-5 gap-2">
                <select
                  value={newShiftRole}
                  onChange={(e) => setNewShiftRole(e.target.value ? Number(e.target.value) : "")}
                  className="border border-gray-300 rounded-md px-2 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                >
                  <option value="">Role...</option>
                  {laborRoles.map((r) => (
                    <option key={r.id} value={r.id}>
                      {r.name}
                    </option>
                  ))}
                </select>
                <select
                  value={newShiftStaff}
                  onChange={(e) => setNewShiftStaff(e.target.value ? Number(e.target.value) : "")}
                  className="border border-gray-300 rounded-md px-2 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                >
                  <option value="">Staff (optional)...</option>
                  {staffList.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.name}
                    </option>
                  ))}
                </select>
                <input
                  type="datetime-local"
                  value={newShiftStart}
                  onChange={(e) => setNewShiftStart(e.target.value)}
                  className="border border-gray-300 rounded-md px-2 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                  placeholder="Start"
                />
                <input
                  type="datetime-local"
                  value={newShiftEnd}
                  onChange={(e) => setNewShiftEnd(e.target.value)}
                  className="border border-gray-300 rounded-md px-2 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                  placeholder="End"
                />
                <button
                  onClick={handleAddShift}
                  disabled={saving || newShiftRole === "" || !newShiftStart || !newShiftEnd}
                  className="bg-blue-600 text-white px-3 py-1.5 rounded text-sm font-medium hover:bg-blue-700 disabled:opacity-50"
                >
                  Add
                </button>
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Equipment Section */}
      <div className="bg-white border border-gray-200 rounded-lg">
        <button
          onClick={() => toggleSection("equipment")}
          className="w-full flex items-center justify-between p-5 text-left"
        >
          <h2 className="text-lg font-semibold text-gray-900">Equipment</h2>
          <ChevronIcon open={sections.equipment} />
        </button>
        {sections.equipment && (
          <div className="px-5 pb-5 border-t border-gray-100 pt-4">
            {event.equipment_reservations.length > 0 ? (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="bg-gray-50 border-b border-gray-200">
                    <tr>
                      <th className="text-left px-3 py-2 font-medium text-gray-700">Equipment</th>
                      <th className="text-right px-3 py-2 font-medium text-gray-700">Qty</th>
                      <th className="text-right px-3 py-2 font-medium text-gray-700">Cost</th>
                      <th className="px-3 py-2"></th>
                    </tr>
                  </thead>
                  <tbody>
                    {event.equipment_reservations.map((res) => (
                      <tr key={res.id} className="border-b border-gray-100 hover:bg-gray-50">
                        <td className="px-3 py-2 text-gray-900">{res.equipment_name}</td>
                        <td className="px-3 py-2 text-right text-gray-900">{res.quantity_out}</td>
                        <td className="px-3 py-2 text-right text-gray-900">
                          {parseFloat(res.line_cost).toFixed(2)}
                        </td>
                        <td className="px-3 py-2 text-center">
                          <button
                            onClick={() => handleDeleteReservation(res.id)}
                            disabled={saving}
                            className="text-red-500 hover:text-red-700 text-sm font-medium disabled:opacity-50"
                            title="Delete reservation"
                          >
                            X
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                  <tfoot className="bg-gray-50 border-t border-gray-300">
                    <tr className="font-semibold">
                      <td colSpan={2} className="px-3 py-2 text-gray-900">
                        Total Equipment Cost
                      </td>
                      <td className="px-3 py-2 text-right text-gray-900">
                        {totalEquipmentCost.toFixed(2)}
                      </td>
                      <td></td>
                    </tr>
                  </tfoot>
                </table>
              </div>
            ) : (
              <p className="text-sm text-gray-500 mb-4">No equipment reserved yet.</p>
            )}

            {/* Add Equipment Form */}
            <div className="mt-4 p-3 bg-gray-50 rounded-lg border border-gray-200">
              <p className="text-sm font-medium text-gray-700 mb-2">Add Equipment</p>
              <div className="grid grid-cols-3 gap-2">
                <select
                  value={newEquipId}
                  onChange={(e) => setNewEquipId(e.target.value ? Number(e.target.value) : "")}
                  className="border border-gray-300 rounded-md px-2 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                >
                  <option value="">Equipment...</option>
                  {equipmentItems.map((eq) => (
                    <option key={eq.id} value={eq.id}>
                      {eq.name}
                    </option>
                  ))}
                </select>
                <input
                  type="number"
                  min={1}
                  value={newEquipQty}
                  onChange={(e) => setNewEquipQty(Number(e.target.value))}
                  className="border border-gray-300 rounded-md px-2 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                  placeholder="Quantity"
                />
                <button
                  onClick={handleAddEquipment}
                  disabled={saving || newEquipId === ""}
                  className="bg-blue-600 text-white px-3 py-1.5 rounded text-sm font-medium hover:bg-blue-700 disabled:opacity-50"
                >
                  Add
                </button>
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Invoices Section */}
      <div className="bg-white border border-gray-200 rounded-lg">
        <button
          onClick={() => toggleSection("invoices")}
          className="w-full flex items-center justify-between p-5 text-left"
        >
          <h2 className="text-lg font-semibold text-gray-900">Invoices</h2>
          <ChevronIcon open={sections.invoices} />
        </button>
        {sections.invoices && (
          <div className="px-5 pb-5 border-t border-gray-100 pt-4">
            {event.invoices.length > 0 ? (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="bg-gray-50 border-b border-gray-200">
                    <tr>
                      <th className="text-left px-3 py-2 font-medium text-gray-700">Invoice #</th>
                      <th className="text-left px-3 py-2 font-medium text-gray-700">Type</th>
                      <th className="text-right px-3 py-2 font-medium text-gray-700">Total</th>
                      <th className="text-center px-3 py-2 font-medium text-gray-700">Status</th>
                      <th className="text-right px-3 py-2 font-medium text-gray-700">
                        Balance Due
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {event.invoices.map((inv) => (
                      <tr key={inv.id} className="border-b border-gray-100 hover:bg-gray-50">
                        <td className="px-3 py-2">
                          <Link
                            href={`/invoices/${inv.id}`}
                            className="text-blue-600 hover:text-blue-800 font-medium"
                          >
                            {inv.invoice_number}
                          </Link>
                        </td>
                        <td className="px-3 py-2 text-gray-700 capitalize">{inv.invoice_type}</td>
                        <td className="px-3 py-2 text-right text-gray-900">
                          {parseFloat(inv.total).toFixed(2)}
                        </td>
                        <td className="px-3 py-2 text-center">
                          <span
                            className={`inline-block px-2 py-0.5 rounded-full text-xs font-medium ${
                              inv.status === "paid"
                                ? "bg-green-100 text-green-800"
                                : inv.status === "overdue"
                                  ? "bg-red-100 text-red-800"
                                  : inv.status === "sent"
                                    ? "bg-blue-100 text-blue-800"
                                    : "bg-gray-100 text-gray-700"
                            }`}
                          >
                            {inv.status}
                          </span>
                        </td>
                        <td className="px-3 py-2 text-right text-gray-900">
                          {parseFloat(inv.balance_due).toFixed(2)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <p className="text-sm text-gray-500 mb-4">No invoices yet.</p>
            )}

            <div className="mt-4">
              <button
                onClick={handleCreateInvoice}
                disabled={saving}
                className="bg-blue-600 text-white px-4 py-2 rounded text-sm font-medium hover:bg-blue-700 disabled:opacity-50"
              >
                {saving ? "Creating..." : "Create Invoice"}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
