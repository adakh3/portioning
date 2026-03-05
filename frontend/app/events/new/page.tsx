"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { api, Contact } from "@/lib/api";
import { useAccounts, useVenues, useSiteSettings, useEventTypes, useServiceStyles } from "@/lib/hooks";
import MenuBuilder from "@/components/MenuBuilder";
import { Button } from "@/components/ui/button";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";

const defaultSettings = {
  currency_symbol: "£",
  currency_code: "GBP",
  default_price_per_head: "0.00",
  target_food_cost_percentage: "30.00",
  price_rounding_step: "50",
};

export default function NewEventPage() {
  const router = useRouter();
  const { data: accounts = [] } = useAccounts();
  const { data: venues = [] } = useVenues();
  const { data: settings } = useSiteSettings();
  const s = settings || defaultSettings;
  const { data: eventTypes = [] } = useEventTypes();
  const { data: serviceStyles = [] } = useServiceStyles();
  const [contacts, setContacts] = useState<Contact[]>([]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [formData, setFormData] = useState({
    name: "",
    date: "",
    totalGuests: "",
    gents: "",
    ladies: "",
    customSplit: false,
    account: "",
    primary_contact: "",
    venue: "",
    venue_address: "",
    event_type: "other",
    service_style: "",
    status: "tentative",
    price_per_head: "",
    notes: "",
  });
  const [menuData, setMenuData] = useState<{
    dish_ids: number[];
    based_on_template: number | null;
  }>({ dish_ids: [], based_on_template: null });
  const [suggestedPrice, setSuggestedPrice] = useState<number | null>(null);
  const handleSuggestedPriceChange = useCallback((price: number | null) => setSuggestedPrice(price), []);

  useEffect(() => {
    if (settings && parseFloat(settings.default_price_per_head) > 0 && !formData.price_per_head) {
      setFormData((prev) => ({ ...prev, price_per_head: settings.default_price_per_head }));
    }
  }, [settings]);

  // Load contacts when account changes
  const prevAccountRef = useRef(formData.account);
  useEffect(() => {
    if (formData.account) {
      const acct = accounts.find((a) => a.id === Number(formData.account));
      setContacts(acct?.contacts || []);
      if (prevAccountRef.current !== formData.account) {
        setFormData((prev) => ({ ...prev, primary_contact: "" }));
      }
    } else {
      setContacts([]);
    }
    prevAccountRef.current = formData.account;
  }, [formData.account, accounts]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    setError("");
    try {
      const gents = Number(formData.gents) || 0;
      const ladies = Number(formData.ladies) || 0;
      const data = {
        name: formData.name,
        date: formData.date,
        gents,
        ladies,
        account: formData.account ? Number(formData.account) : null,
        primary_contact: formData.primary_contact ? Number(formData.primary_contact) : null,
        venue: formData.venue ? Number(formData.venue) : null,
        venue_address: formData.venue_address,
        event_type: formData.event_type,
        service_style: formData.service_style || "",
        status: formData.status,
        price_per_head: formData.price_per_head ? formData.price_per_head : null,
        notes: formData.notes,
        dish_ids: menuData.dish_ids,
        based_on_template: menuData.based_on_template,
      };
      const event = await api.createEvent(data);
      router.push(`/events/${event.id}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to create event");
      setSaving(false);
    }
  }

  const set = (field: string) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) =>
    setFormData({ ...formData, [field]: e.target.value });

  const venueSelected = !!formData.venue;

  return (
    <div>
      <Button variant="link" asChild className="mb-4 p-0 h-auto">
        <Link href="/events">&larr; Back to Events</Link>
      </Button>
      <h1 className="text-2xl font-bold text-foreground mb-6">New Event</h1>

      {error && <p className="text-destructive mb-4">{error}</p>}

      <form onSubmit={handleSubmit} className="space-y-6">
        {/* Basic Info */}
        <Card>
          <CardHeader>
            <CardTitle className="text-lg">Event Info</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="md:col-span-2">
                <label className="block text-sm font-medium text-foreground mb-1">Event Name *</label>
                <Input type="text" required value={formData.name} onChange={set("name")} placeholder="e.g. Smith Wedding Reception" />
              </div>
              <div>
                <label className="block text-sm font-medium text-foreground mb-1">Date *</label>
                <Input type="date" required value={formData.date} onChange={set("date")} />
              </div>
              <div>
                <label className="block text-sm font-medium text-foreground mb-1">Status</label>
                <select value={formData.status} onChange={set("status")} className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring">
                  <option value="tentative">Tentative</option>
                  <option value="confirmed">Confirmed</option>
                </select>
              </div>
              <div>
                <label className="block text-sm font-medium text-foreground mb-1">Event Type</label>
                <select value={formData.event_type} onChange={set("event_type")} className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring">
                  {eventTypes.map((et) => <option key={et.id} value={et.value}>{et.label}</option>)}
                </select>
              </div>
              <div>
                <label className="block text-sm font-medium text-foreground mb-1">Service Style</label>
                <select value={formData.service_style} onChange={set("service_style")} className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring">
                  <option value="">-- Select --</option>
                  {serviceStyles.map((ss) => <option key={ss.id} value={ss.value}>{ss.label}</option>)}
                </select>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Guest Count */}
        <Card>
          <CardHeader>
            <CardTitle className="text-lg">Guests</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-3">
              <div>
                <label className="block text-sm font-medium text-foreground mb-1">Total Guests *</label>
                <Input
                  type="number"
                  required
                  min={1}
                  value={formData.totalGuests}
                  onChange={(e) => {
                    const total = parseInt(e.target.value) || 0;
                    if (formData.customSplit) {
                      const prevTotal = Number(formData.gents || 0) + Number(formData.ladies || 0);
                      const ratio = prevTotal > 0 ? Number(formData.gents || 0) / prevTotal : 0.5;
                      const gents = Math.round(total * ratio);
                      setFormData({ ...formData, totalGuests: e.target.value, gents: String(gents), ladies: String(total - gents) });
                    } else {
                      setFormData({ ...formData, totalGuests: e.target.value, gents: String(Math.ceil(total / 2)), ladies: String(Math.floor(total / 2)) });
                    }
                  }}
                  className="max-w-[200px]"
                />
              </div>
              <div>
                <label className="flex items-center gap-2 text-sm text-foreground cursor-pointer">
                  <input
                    type="checkbox"
                    checked={formData.customSplit}
                    onChange={(e) => {
                      const custom = e.target.checked;
                      if (!custom) {
                        const total = parseInt(formData.totalGuests) || 0;
                        setFormData({ ...formData, customSplit: false, gents: String(Math.ceil(total / 2)), ladies: String(Math.floor(total / 2)) });
                      } else {
                        setFormData({ ...formData, customSplit: true });
                      }
                    }}
                    className="rounded border-input"
                  />
                  Customise split
                </label>
                {formData.customSplit && (
                  <div className="grid grid-cols-2 gap-4 mt-2">
                    <div>
                      <label className="block text-sm text-muted-foreground mb-1">Gents</label>
                      <Input
                        type="number"
                        min={0}
                        value={formData.gents}
                        onChange={(e) => {
                          const gents = parseInt(e.target.value) || 0;
                          const total = parseInt(formData.totalGuests) || 0;
                          setFormData({ ...formData, gents: e.target.value, ladies: String(Math.max(0, total - gents)) });
                        }}
                      />
                    </div>
                    <div>
                      <label className="block text-sm text-muted-foreground mb-1">Ladies</label>
                      <Input
                        type="number"
                        min={0}
                        value={formData.ladies}
                        onChange={(e) => {
                          const ladies = parseInt(e.target.value) || 0;
                          const total = parseInt(formData.totalGuests) || 0;
                          setFormData({ ...formData, ladies: e.target.value, gents: String(Math.max(0, total - ladies)) });
                        }}
                      />
                    </div>
                  </div>
                )}
                {!formData.customSplit && parseInt(formData.totalGuests) > 0 && (
                  <p className="text-xs text-muted-foreground mt-1">
                    Split: {Math.ceil(parseInt(formData.totalGuests) / 2)} gents / {Math.floor(parseInt(formData.totalGuests) / 2)} ladies
                  </p>
                )}
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Customer */}
        <Card>
          <CardHeader>
            <CardTitle className="text-lg">Customer</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium text-foreground mb-1">Account *</label>
                <select required value={formData.account} onChange={set("account")} className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring">
                  <option value="">-- Select account --</option>
                  {accounts.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
                </select>
              </div>
              <div>
                <label className="block text-sm font-medium text-foreground mb-1">Contact Person</label>
                <select value={formData.primary_contact} onChange={set("primary_contact")} disabled={!formData.account} className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50">
                  <option value="">-- Select Contact --</option>
                  {contacts.map((c) => <option key={c.id} value={c.id}>{c.name} ({c.role})</option>)}
                </select>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Venue */}
        <Card>
          <CardHeader>
            <CardTitle className="text-lg">Venue</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium text-foreground mb-1">Saved Venue</label>
                <select value={formData.venue} onChange={set("venue")} className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring">
                  <option value="">-- No saved venue --</option>
                  {venues.map((v) => <option key={v.id} value={v.id}>{v.name} — {v.city}</option>)}
                </select>
              </div>
              <div>
                <label className="block text-sm font-medium text-foreground mb-1">
                  {venueSelected ? "Additional Address Notes" : "Venue Address (freeform)"}
                </label>
                <Textarea
                  value={formData.venue_address}
                  onChange={set("venue_address")}
                  rows={2}
                  placeholder={venueSelected ? "e.g. Use the garden entrance" : "e.g. 42 Oak Lane, Manchester, M1 2AB"}
                />
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Menu */}
        <Card>
          <CardHeader>
            <CardTitle className="text-lg">Menu</CardTitle>
          </CardHeader>
          <CardContent>
            <MenuBuilder
              selectedDishIds={menuData.dish_ids}
              basedOnTemplate={menuData.based_on_template}
              guestCount={parseInt(formData.totalGuests) || 0}
              onChange={setMenuData}
              onSuggestedPriceChange={handleSuggestedPriceChange}
              onUseSuggestedPrice={(price) => setFormData((prev) => ({ ...prev, price_per_head: price.toFixed(2) }))}
              currencySymbol={s.currency_symbol}
            />
          </CardContent>
        </Card>

        {/* Pricing */}
        <Card>
          <CardHeader>
            <CardTitle className="text-lg">Pricing</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium text-foreground mb-1">Price Per Head ({s.currency_symbol})</label>
                <div className="flex gap-2">
                  <Input
                    type="number"
                    step="0.01"
                    min={0}
                    value={formData.price_per_head}
                    onChange={set("price_per_head")}
                    placeholder="0.00"
                  />
                  {suggestedPrice !== null && (
                    <Button
                      type="button"
                      variant="outline"
                      onClick={() => setFormData({ ...formData, price_per_head: suggestedPrice.toFixed(2) })}
                      className="whitespace-nowrap border-success/30 text-success bg-success/10 hover:bg-success/15 hover:text-success"
                    >
                      Use {s.currency_symbol}{suggestedPrice.toFixed(2)}
                    </Button>
                  )}
                </div>
                {suggestedPrice !== null && (
                  <p className="text-xs text-success/80 mt-1">
                    Suggested: {s.currency_symbol}{suggestedPrice.toFixed(2)}/head
                  </p>
                )}
                {formData.price_per_head && parseInt(formData.totalGuests) > 0 && (
                  <p className="text-xs text-muted-foreground mt-1">
                    Food total: {s.currency_symbol}{(parseFloat(formData.price_per_head) * (parseInt(formData.totalGuests) || 0)).toFixed(2)} ({parseInt(formData.totalGuests)} guests)
                  </p>
                )}
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Notes */}
        <Card>
          <CardHeader>
            <CardTitle className="text-lg">Notes</CardTitle>
          </CardHeader>
          <CardContent>
            <Textarea value={formData.notes} onChange={set("notes")} rows={3} placeholder="Any notes about this event..." />
          </CardContent>
        </Card>

        <Button type="submit" disabled={saving} variant="success">
          {saving ? "Creating..." : "Create Event"}
        </Button>
      </form>
    </div>
  );
}
