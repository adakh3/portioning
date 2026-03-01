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

export default function NewQuotePage() {
  const router = useRouter();
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [contacts, setContacts] = useState<Contact[]>([]);
  const [venues, setVenues] = useState<Venue[]>([]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [settings, setSettings] = useState<SiteSettingsData>({ currency_symbol: "£", currency_code: "GBP", default_price_per_head: "0.00", target_food_cost_percentage: "30.00", price_rounding_step: "50" });
  const [formData, setFormData] = useState({
    account: "",
    primary_contact: "",
    venue: "",
    venue_address: "",
    event_date: "",
    guest_count: "",
    price_per_head: "",
    event_type: "other",
    service_style: "",
    tax_rate: "0.2000",
    valid_until: "",
    notes: "",
    internal_notes: "",
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
      const data = {
        account: Number(formData.account),
        primary_contact: formData.primary_contact ? Number(formData.primary_contact) : null,
        venue: formData.venue ? Number(formData.venue) : null,
        venue_address: formData.venue_address,
        event_date: formData.event_date,
        guest_count: Number(formData.guest_count),
        price_per_head: formData.price_per_head ? formData.price_per_head : null,
        event_type: formData.event_type,
        service_style: formData.service_style || undefined,
        tax_rate: formData.tax_rate,
        valid_until: formData.valid_until || null,
        notes: formData.notes,
        internal_notes: formData.internal_notes,
        dish_ids: menuData.dish_ids,
        based_on_template: menuData.based_on_template,
      };
      const quote = await api.createQuote(data);
      router.push(`/quotes/${quote.id}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to create quote");
      setSaving(false);
    }
  }

  const set = (field: string) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) =>
    setFormData({ ...formData, [field]: e.target.value });

  const venueSelected = !!formData.venue;

  return (
    <div>
      <Button variant="link" asChild className="mb-4 p-0 h-auto">
        <Link href="/quotes">&larr; Back to Quotes</Link>
      </Button>
      <h1 className="text-2xl font-bold text-foreground mb-6">New Quote</h1>

      {error && <p className="text-destructive mb-4">{error}</p>}

      <form onSubmit={handleSubmit} className="space-y-6">
        {/* Customer & Contact */}
        <Card>
          <CardHeader>
            <CardTitle className="text-lg">Customer</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium text-foreground mb-1">Account *</label>
                <select required value={formData.account} onChange={set("account")} className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring">
                  <option value="">-- Select Account --</option>
                  {accounts.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
                </select>
              </div>
              <div>
                <label className="block text-sm font-medium text-foreground mb-1">Contact Person</label>
                <select value={formData.primary_contact} onChange={set("primary_contact")} disabled={!formData.account} className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50">
                  <option value="">-- Select Contact --</option>
                  {contacts.map((c) => <option key={c.id} value={c.id}>{c.name} ({c.role})</option>)}
                </select>
                {formData.account && contacts.length === 0 && (
                  <p className="text-xs text-muted-foreground mt-1">No contacts on this account</p>
                )}
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Event Details */}
        <Card>
          <CardHeader>
            <CardTitle className="text-lg">Event Details</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium text-foreground mb-1">Event Date *</label>
                <Input type="date" required value={formData.event_date} onChange={set("event_date")} />
              </div>
              <div>
                <label className="block text-sm font-medium text-foreground mb-1">Guest Count *</label>
                <Input type="number" required min={1} value={formData.guest_count} onChange={set("guest_count")} />
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
              guestCount={formData.guest_count ? Number(formData.guest_count) : undefined}
              onChange={setMenuData}
              onSuggestedPriceChange={handleSuggestedPriceChange}
              onUseSuggestedPrice={(price) => setFormData((prev) => ({ ...prev, price_per_head: price.toFixed(2) }))}
              currencySymbol={settings.currency_symbol}
              priceRoundingStep={Number(settings.price_rounding_step) || 50}
            />
          </CardContent>
        </Card>

        {/* Pricing & Terms */}
        <Card>
          <CardHeader>
            <CardTitle className="text-lg">Pricing & Terms</CardTitle>
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
                {formData.price_per_head && formData.guest_count && (
                  <p className="text-xs text-muted-foreground mt-1">
                    Food total: {settings.currency_symbol}{(parseFloat(formData.price_per_head) * Number(formData.guest_count)).toFixed(2)} ({formData.guest_count} guests)
                  </p>
                )}
              </div>
              <div>
                <label className="block text-sm font-medium text-foreground mb-1">Tax Rate (%)</label>
                <Input
                  type="number"
                  step="0.01"
                  min={0}
                  max={100}
                  value={Math.round(parseFloat(formData.tax_rate) * 10000) / 100}
                  onChange={(e) => setFormData({ ...formData, tax_rate: (parseFloat(e.target.value) / 100).toFixed(4) })}
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-foreground mb-1">Valid Until</label>
                <Input type="date" value={formData.valid_until} onChange={set("valid_until")} />
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
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium text-foreground mb-1">Notes (customer-visible)</label>
                <Textarea value={formData.notes} onChange={set("notes")} rows={3} />
              </div>
              <div>
                <label className="block text-sm font-medium text-foreground mb-1">Internal Notes</label>
                <Textarea value={formData.internal_notes} onChange={set("internal_notes")} rows={3} />
              </div>
            </div>
          </CardContent>
        </Card>

        <Button type="submit" disabled={saving} variant="success">
          {saving ? "Creating..." : "Create Quote"}
        </Button>
      </form>
    </div>
  );
}
