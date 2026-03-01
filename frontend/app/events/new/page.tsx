"use client";

import { useState, useEffect, useCallback } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { api, Account, Contact, Venue, SiteSettingsData } from "@/lib/api";
import MenuBuilder from "@/components/MenuBuilder";
import { Button } from "@/components/ui/button";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";

export default function NewEventPage() {
  const router = useRouter();
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [contacts, setContacts] = useState<Contact[]>([]);
  const [venues, setVenues] = useState<Venue[]>([]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [settings, setSettings] = useState<SiteSettingsData>({ currency_symbol: "£", currency_code: "GBP", default_price_per_head: "0.00", target_food_cost_percentage: "30.00", price_rounding_step: "50" });
  const [formData, setFormData] = useState({
    name: "",
    date: "",
    gents: "",
    ladies: "",
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
    Promise.all([api.getAccounts(), api.getVenues(), api.getSiteSettings()])
      .then(([a, v, s]) => {
        setAccounts(a);
        setVenues(v);
        setSettings(s);
        if (parseFloat(s.default_price_per_head) > 0) {
          setFormData((prev) => ({ ...prev, price_per_head: s.default_price_per_head }));
        }
      })
      .catch(() => {});
  }, []);

  // Load contacts when account changes
  useEffect(() => {
    if (formData.account) {
      const acct = accounts.find((a) => a.id === Number(formData.account));
      setContacts(acct?.contacts || []);
      setFormData((prev) => ({ ...prev, primary_contact: "" }));
    } else {
      setContacts([]);
    }
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
                  <option value="wedding">Wedding</option>
                  <option value="corporate">Corporate Event</option>
                  <option value="birthday">Birthday Party</option>
                  <option value="funeral">Funeral / Wake</option>
                  <option value="religious">Religious Event</option>
                  <option value="social">Social Gathering</option>
                  <option value="other">Other</option>
                </select>
              </div>
              <div>
                <label className="block text-sm font-medium text-foreground mb-1">Service Style</label>
                <select value={formData.service_style} onChange={set("service_style")} className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring">
                  <option value="">-- Select --</option>
                  <option value="buffet">Buffet</option>
                  <option value="plated">Plated / Sit-down</option>
                  <option value="stations">Food Stations</option>
                  <option value="family_style">Family Style</option>
                  <option value="boxed">Boxed / Individual</option>
                  <option value="canapes">Canapes</option>
                  <option value="mixed">Mixed Service</option>
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
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium text-foreground mb-1">Gents *</label>
                <Input type="number" required min={0} value={formData.gents} onChange={set("gents")} />
              </div>
              <div>
                <label className="block text-sm font-medium text-foreground mb-1">Ladies *</label>
                <Input type="number" required min={0} value={formData.ladies} onChange={set("ladies")} />
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
                <label className="block text-sm font-medium text-foreground mb-1">Account</label>
                <select value={formData.account} onChange={set("account")} className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring">
                  <option value="">-- No account --</option>
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
              onChange={setMenuData}
              onSuggestedPriceChange={handleSuggestedPriceChange}
              onUseSuggestedPrice={(price) => setFormData((prev) => ({ ...prev, price_per_head: price.toFixed(2) }))}
              currencySymbol={settings.currency_symbol}
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
                <label className="block text-sm font-medium text-foreground mb-1">Price Per Head ({settings.currency_symbol})</label>
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
                      Use {settings.currency_symbol}{suggestedPrice.toFixed(2)}
                    </Button>
                  )}
                </div>
                {suggestedPrice !== null && (
                  <p className="text-xs text-success/80 mt-1">
                    Suggested: {settings.currency_symbol}{suggestedPrice.toFixed(2)}/head
                  </p>
                )}
                {formData.price_per_head && (formData.gents || formData.ladies) && (
                  <p className="text-xs text-muted-foreground mt-1">
                    Food total: {settings.currency_symbol}{(parseFloat(formData.price_per_head) * (Number(formData.gents || 0) + Number(formData.ladies || 0))).toFixed(2)} ({Number(formData.gents || 0) + Number(formData.ladies || 0)} guests)
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
