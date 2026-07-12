"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import { api, SiteSettingsData } from "@/lib/api";
import { useSiteSettings } from "@/lib/hooks";
import { useAuth } from "@/lib/auth";
import { useQueryState } from "@/lib/useQueryState";
import { settingsTabsFor } from "@/lib/settingsTabs";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ValidatedInput } from "@/components/ui/validated-input";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import LeadStatusesSettings from "@/components/LeadStatusesSettings";
import ChoiceOptionsSettings from "@/components/ChoiceOptionsSettings";
import ProductLinesSettings from "@/components/ProductLinesSettings";
import CommissionSettings from "@/components/CommissionSettings";
import BillingPanel from "@/components/BillingPanel";

// default_tax_rate is stored as a fraction (0.20 = 20%); show it as a percentage.
const pctFromFraction = (f: string) => String(Math.round(Number(f || 0) * 10000) / 100);
const fractionFromPct = (p: string) => (Number(p || 0) / 100).toFixed(4);

export default function SettingsPage() {
  const { data: settings, isLoading: loading, mutate: mutateSettings } = useSiteSettings();
  const { user } = useAuth();
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [tabRaw, setTab] = useQueryState("tab", "general");
  const isOwner = user?.role === "owner" || !!user?.is_superuser;
  const tabs = settingsTabsFor(isOwner);
  const tab = tabs.some((t) => t.id === tabRaw) ? tabRaw : "general";

  const [formData, setFormData] = useState({
    currency_symbol: "",
    currency_code: "",
    date_format: "DD/MM/YYYY",
    time_format: "24h",
    timezone: "",
    tax_label: "",
    default_tax_rate: "",
    default_price_per_head: "",
    default_guest_profile: "gents",
    target_food_cost_percentage: "",
    price_rounding_step: "50",
    quotation_terms: "",
  });
  // JSON snapshot of the form as last synced from the server — used to detect
  // unsaved changes reliably (independent of how `settings` is recomputed).
  const [savedSnapshot, setSavedSnapshot] = useState<string | null>(null);

  // WhatsApp toggle state (separate save)
  const [waEnabled, setWaEnabled] = useState(false);
  const [waSaving, setWaSaving] = useState(false);
  const [waError, setWaError] = useState("");
  const [waSuccess, setWaSuccess] = useState("");

  useEffect(() => {
    if (settings) {
      const f = {
        currency_symbol: settings.currency_symbol,
        currency_code: settings.currency_code,
        date_format: settings.date_format || "DD/MM/YYYY",
        time_format: settings.time_format || "24h",
        timezone: settings.timezone || "",
        tax_label: settings.tax_label || "",
        default_tax_rate: settings.default_tax_rate || "",
        default_price_per_head: settings.default_price_per_head,
        default_guest_profile: settings.default_guest_profile || "gents",
        target_food_cost_percentage: settings.target_food_cost_percentage,
        price_rounding_step: settings.price_rounding_step || "50",
        quotation_terms: settings.quotation_terms || "",
      };
      setFormData(f);
      setSavedSnapshot(JSON.stringify(f));
      setWaEnabled(settings.whatsapp_enabled || false);
    }
  }, [settings]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    setError("");
    setSuccess("");
    try {
      await api.updateSiteSettings(formData);
      setSavedSnapshot(JSON.stringify(formData)); // form is now clean
      mutateSettings();
      setSuccess("Settings saved successfully.");
      setTimeout(() => setSuccess(""), 3000);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to save settings");
    } finally {
      setSaving(false);
    }
  }

  async function handleWhatsAppToggle(enabled: boolean) {
    setWaSaving(true);
    setWaError("");
    setWaSuccess("");
    try {
      await api.updateSiteSettings({ whatsapp_enabled: enabled });
      setWaEnabled(enabled);
      mutateSettings();
      setWaSuccess(enabled ? "WhatsApp enabled." : "WhatsApp disabled.");
      setTimeout(() => setWaSuccess(""), 3000);
    } catch (err) {
      setWaError(err instanceof Error ? err.message : "Failed to save");
    } finally {
      setWaSaving(false);
    }
  }

  const dirty = savedSnapshot !== null && JSON.stringify(formData) !== savedSnapshot;

  if (loading) return <p className="text-muted-foreground">Loading settings...</p>;

  return (
    <div>
      <Button variant="link" asChild className="mb-4 p-0 h-auto">
        <Link href="/">&larr; Home</Link>
      </Button>
      <h1 className="text-2xl font-bold text-foreground mb-6">Settings</h1>

      <div className="flex gap-1 border-b border-border mb-6 overflow-x-auto overflow-y-hidden">
        {tabs.map((t) => (
          <button
            key={t.id}
            type="button"
            onClick={() => setTab(t.id)}
            className={cn(
              "px-4 py-2 text-sm font-medium border-b-2 -mb-px whitespace-nowrap transition-colors",
              tab === t.id
                ? "border-primary text-foreground"
                : "border-transparent text-muted-foreground hover:text-foreground",
            )}
          >
            {t.label}
          </button>
        ))}
      </div>

      {tab === "general" && (
      <form onSubmit={handleSubmit} className="max-w-2xl">
        <Card>
          <CardHeader>
            <CardTitle>General</CardTitle>
          </CardHeader>
          <CardContent className="space-y-6">
            {/* Currency */}
            <div>
              <h3 className="text-sm font-semibold text-foreground mb-2">Currency</h3>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-foreground mb-1">Currency Symbol *</label>
                  <Input
                    type="text"
                    required
                    maxLength={5}
                    value={formData.currency_symbol}
                    onChange={(e) => setFormData({ ...formData, currency_symbol: e.target.value })}
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-foreground mb-1">Currency Code *</label>
                  <Input
                    type="text"
                    required
                    maxLength={5}
                    value={formData.currency_code}
                    onChange={(e) => setFormData({ ...formData, currency_code: e.target.value })}
                  />
                </div>
              </div>
            </div>

            {/* Regional */}
            <div>
              <h3 className="text-sm font-semibold text-foreground mb-2">Regional</h3>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-foreground mb-1">Date Format</label>
                  <select
                    value={formData.date_format}
                    onChange={(e) => setFormData({ ...formData, date_format: e.target.value })}
                    className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                  >
                    {(settings?.date_format_choices || []).map((c: { value: string; label: string }) => (
                      <option key={c.value} value={c.value}>{c.label}</option>
                    ))}
                  </select>
                  <p className="text-xs text-muted-foreground mt-1">
                    Controls how dates are displayed across the application.
                  </p>
                </div>
                <div>
                  <label className="block text-sm font-medium text-foreground mb-1">Time Format</label>
                  <select
                    value={formData.time_format}
                    onChange={(e) => setFormData({ ...formData, time_format: e.target.value })}
                    className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                  >
                    {(settings?.time_format_choices || [{ value: "24h", label: "24-hour (e.g. 19:00)" }, { value: "12h", label: "12-hour AM/PM (e.g. 7:00 PM)" }]).map((c: { value: string; label: string }) => (
                      <option key={c.value} value={c.value}>{c.label}</option>
                    ))}
                  </select>
                  <p className="text-xs text-muted-foreground mt-1">
                    Controls AM/PM vs 24-hour time entry and display.
                  </p>
                </div>
                <div>
                  <label className="block text-sm font-medium text-foreground mb-1">Timezone</label>
                  <Input
                    type="text"
                    placeholder="e.g. Asia/Karachi"
                    value={formData.timezone}
                    onChange={(e) => setFormData({ ...formData, timezone: e.target.value })}
                  />
                  <p className="text-xs text-muted-foreground mt-1">
                    IANA timezone for dates/times (e.g. Asia/Karachi, Europe/London).
                  </p>
                </div>
              </div>
            </div>

            {/* Tax */}
            <div>
              <h3 className="text-sm font-semibold text-foreground mb-2">Tax</h3>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-foreground mb-1">Tax Label</label>
                  <Input
                    type="text"
                    maxLength={20}
                    placeholder="e.g. VAT, GST, Sales Tax"
                    value={formData.tax_label}
                    onChange={(e) => setFormData({ ...formData, tax_label: e.target.value })}
                  />
                  <p className="text-xs text-muted-foreground mt-1">
                    Name of the tax shown on quotations.
                  </p>
                </div>
                <div>
                  <label className="block text-sm font-medium text-foreground mb-1">Default Tax Rate %</label>
                  <ValidatedInput
                    type="number"
                    step="0.01"
                    min="0"
                    max="100"
                    value={pctFromFraction(formData.default_tax_rate)}
                    onChange={(e) => setFormData({ ...formData, default_tax_rate: fractionFromPct(e.target.value) })}
                  />
                  <p className="text-xs text-muted-foreground mt-1">
                    e.g. 17 for 17%.
                  </p>
                </div>
              </div>
            </div>

            {/* Pricing Defaults */}
            <div>
              <h3 className="text-sm font-semibold text-foreground mb-2">Pricing Defaults</h3>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-foreground mb-1">Default Price Per Head ({formData.currency_symbol})</label>
                  <ValidatedInput
                    type="number"
                    step="0.01"
                    min="0"
                    max="9999999.99"
                    value={formData.default_price_per_head}
                    onChange={(e) => setFormData({ ...formData, default_price_per_head: e.target.value })}
                  />
                  <p className="text-xs text-muted-foreground mt-1">
                    Pre-filled when creating new quotes and events. Set to 0 to leave blank.
                  </p>
                </div>
                <div>
                  <label className="block text-sm font-medium text-foreground mb-1">Target Food Cost %</label>
                  <ValidatedInput
                    type="number"
                    step="0.01"
                    min="0"
                    max="100"
                    value={formData.target_food_cost_percentage}
                    onChange={(e) => setFormData({ ...formData, target_food_cost_percentage: e.target.value })}
                  />
                  <p className="text-xs text-muted-foreground mt-1">
                    Used to calculate selling prices from food costs. For example, if food cost is {formData.currency_symbol}3.00
                    and target food cost is 30%, the suggested selling price would be {formData.currency_symbol}10.00/head.
                  </p>
                </div>
                <div>
                  <label className="block text-sm font-medium text-foreground mb-1">Price Rounding Step</label>
                  <ValidatedInput
                    type="number"
                    step="1"
                    min="1"
                    max="1000"
                    value={formData.price_rounding_step}
                    onChange={(e) => setFormData({ ...formData, price_rounding_step: e.target.value })}
                  />
                  <p className="text-xs text-muted-foreground mt-1">
                    Round calculated prices to the nearest N. For example, 50 rounds {formData.currency_symbol}2,017 to {formData.currency_symbol}2,000.
                    Set to 1 to disable rounding.
                  </p>
                </div>
                <div>
                  <label className="block text-sm font-medium text-foreground mb-1">Default Portion Rule (no guest split)</label>
                  <select
                    value={formData.default_guest_profile}
                    onChange={(e) => setFormData({ ...formData, default_guest_profile: e.target.value })}
                    className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                  >
                    <option value="gents">Standard (gents)</option>
                    <option value="ladies">Ladies</option>
                  </select>
                  <p className="text-xs text-muted-foreground mt-1">
                    Which portion rule applies to all guests when an event has no gents/ladies split.
                  </p>
                </div>
              </div>
              <div className="mt-4">
                <label className="block text-sm font-medium text-foreground mb-1">Terms &amp; Conditions</label>
                <textarea
                  value={formData.quotation_terms}
                  onChange={(e) => setFormData({ ...formData, quotation_terms: e.target.value })}
                  rows={6}
                  className="flex w-full rounded-md border border-input bg-transparent px-3 py-2 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                  placeholder="Printed on the Terms & Conditions page of every quotation PDF. One paragraph per line."
                />
                <p className="text-xs text-muted-foreground mt-1">
                  Shown on the Terms &amp; Conditions page of quotation PDFs.
                </p>
              </div>
            </div>

            {/* Save — footer of this card */}
            <div className="flex items-center gap-3 border-t border-border pt-4">
              <Button type="submit" disabled={saving || !dirty}>
                {saving ? "Saving..." : "Save Settings"}
              </Button>
              {error && <span className="text-destructive text-sm">{error}</span>}
              {success && <span className="text-success text-sm">{success}</span>}
              {!dirty && !saving && !success && !error && (
                <span className="text-muted-foreground text-sm">No unsaved changes</span>
              )}
            </div>
          </CardContent>
        </Card>
      </form>
      )}

      {tab === "pipeline" && (
      <div className="space-y-6 max-w-2xl">
        <LeadStatusesSettings />
      </div>
      )}

      {tab === "options" && (
      <div className="space-y-6 max-w-2xl">
        <ChoiceOptionsSettings
          title="Event Types"
          base="/bookings/settings/event-types/"
          swrKey="managed-event-types"
          revalidateKey="event-types"
          description="The event types selectable on leads, quotes and events (e.g. Wedding, Corporate)."
          addPlaceholder="New event type…"
        />
        <ChoiceOptionsSettings
          title="Lead Sources"
          base="/bookings/settings/sources/"
          swrKey="managed-sources"
          revalidateKey="sources"
          description="Where leads come from (e.g. Website, Referral, Instagram)."
          addPlaceholder="New source…"
        />
        <ChoiceOptionsSettings
          title="Service Styles"
          base="/bookings/settings/service-styles/"
          swrKey="managed-service-styles"
          revalidateKey="service-styles"
          description="How food is served (e.g. Buffet, Plated, Family style)."
          addPlaceholder="New service style…"
        />
        <ChoiceOptionsSettings
          title="Meal Types"
          base="/bookings/settings/meal-types/"
          swrKey="managed-meal-types"
          revalidateKey="meal-types"
          description="Selectable meal types (e.g. Lunch, Dinner)."
          addPlaceholder="New meal type…"
        />
        <ChoiceOptionsSettings
          title="Lost Reasons"
          base="/bookings/settings/lost-reasons/"
          swrKey="managed-lost-reasons"
          revalidateKey="lost-reasons"
          description="Reasons a lead is marked lost (shown when losing a lead)."
          addPlaceholder="New lost reason…"
        />
      </div>
      )}

      {tab === "branding" && (
      <div className="space-y-6 max-w-2xl">
        <ProductLinesSettings />
      </div>
      )}

      {tab === "commission" && (
      <div className="space-y-6 max-w-3xl">
        <CommissionSettings />
      </div>
      )}

      {tab === "integrations" && (
      <div className="space-y-6 max-w-2xl">
        <WhatsAppSettings settings={settings} onSave={() => mutateSettings()} />
        <AIFollowUpSettings settings={settings} onSave={() => mutateSettings()} />
      </div>
      )}

      {tab === "billing" && (
      <div className="space-y-6 max-w-2xl">
        <BillingPanel />
      </div>
      )}
    </div>
  );
}


function WhatsAppSettings({ settings, onSave }: { settings: SiteSettingsData | undefined; onSave: () => void }) {
  const [enabled, setEnabled] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");

  useEffect(() => {
    if (settings) {
      setEnabled(settings.whatsapp_enabled || false);
    }
  }, [settings]);

  async function handleToggle(val: boolean) {
    setSaving(true);
    setError("");
    setSuccess("");
    try {
      await api.updateSiteSettings({ whatsapp_enabled: val });
      setEnabled(val);
      onSave();
      setSuccess(val ? "WhatsApp enabled." : "WhatsApp disabled.");
      setTimeout(() => setSuccess(""), 3000);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to save");
    } finally {
      setSaving(false);
    }
  }

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between">
          <CardTitle>WhatsApp</CardTitle>
          {settings?.twilio_configured ? (
            <Badge variant="success">Connected</Badge>
          ) : (
            <Badge variant="secondary">Not connected</Badge>
          )}
        </div>
      </CardHeader>
      <CardContent>
        {error && <p className="text-destructive mb-3 text-sm">{error}</p>}
        {success && <p className="text-success mb-3 text-sm">{success}</p>}
        {settings?.twilio_configured ? (
          <div className="space-y-4">
            <div className="text-sm text-muted-foreground">
              WhatsApp number: <span className="font-medium text-foreground">{settings.twilio_whatsapp_number}</span>
            </div>
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm font-medium text-foreground">WhatsApp Messaging</p>
                <p className="text-xs text-muted-foreground">Send and receive messages from leads via WhatsApp.</p>
              </div>
              <Button
                variant={enabled ? "default" : "outline"}
                size="sm"
                onClick={() => handleToggle(!enabled)}
                disabled={saving}
              >
                {saving ? "Saving..." : enabled ? "Enabled" : "Disabled"}
              </Button>
            </div>
          </div>
        ) : (
          <p className="text-sm text-muted-foreground">
            WhatsApp has not been set up for your organisation yet. Please contact support to connect your WhatsApp Business number.
          </p>
        )}
      </CardContent>
    </Card>
  );
}


function AIFollowUpSettings({ settings, onSave }: { settings: SiteSettingsData | undefined; onSave: () => void }) {
  const [enabled, setEnabled] = useState(false);
  const [staleHours, setStaleHours] = useState("168");
  const [maxDrafts, setMaxDrafts] = useState("3");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");

  useEffect(() => {
    if (settings) {
      setEnabled(settings.ai_followups_enabled || false);
      setStaleHours(String(settings.followup_stale_hours ?? 168));
      setMaxDrafts(String(settings.followup_max_drafts_per_lead ?? 3));
    }
  }, [settings]);

  async function handleSave() {
    setSaving(true);
    setError("");
    setSuccess("");
    try {
      await api.updateSiteSettings({
        ai_followups_enabled: enabled,
        followup_stale_hours: Number(staleHours),
        followup_max_drafts_per_lead: Number(maxDrafts),
      });
      onSave();
      setSuccess("AI follow-up settings saved.");
      setTimeout(() => setSuccess(""), 3000);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to save");
    } finally {
      setSaving(false);
    }
  }

  // configured requires both the org opt-in AND the platform Anthropic key.
  const badge = !enabled
    ? { variant: "secondary" as const, label: "Disabled" }
    : settings?.ai_followups_configured
      ? { variant: "success" as const, label: "Active" }
      : { variant: "warning" as const, label: "No API key" };

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between">
          <CardTitle>AI Follow-ups</CardTitle>
          <Badge variant={badge.variant}>{badge.label}</Badge>
        </div>
      </CardHeader>
      <CardContent>
        {error && <p className="text-destructive mb-3 text-sm">{error}</p>}
        {success && <p className="text-success mb-3 text-sm">{success}</p>}
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm font-medium text-foreground">Draft follow-ups for quiet leads</p>
              <p className="text-xs text-muted-foreground">
                The agent drafts WhatsApp follow-ups for stale leads. Every draft is reviewed before it&apos;s sent.
              </p>
            </div>
            <Button
              variant={enabled ? "default" : "outline"}
              size="sm"
              onClick={() => setEnabled(!enabled)}
            >
              {enabled ? "Enabled" : "Disabled"}
            </Button>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-foreground mb-1">Stale after (hours)</label>
              <Input
                type="number"
                min={1}
                value={staleHours}
                onChange={(e) => setStaleHours(e.target.value)}
              />
              <p className="text-xs text-muted-foreground mt-1">Untouched time before drafting (168 = 7 days).</p>
            </div>
            <div>
              <label className="block text-sm font-medium text-foreground mb-1">Max drafts per lead</label>
              <Input
                type="number"
                min={1}
                value={maxDrafts}
                onChange={(e) => setMaxDrafts(e.target.value)}
              />
              <p className="text-xs text-muted-foreground mt-1">Never nudge one lead more than this.</p>
            </div>
          </div>

          {enabled && !settings?.ai_followups_configured && (
            <p className="text-xs text-warning">
              Enabled, but the platform Anthropic API key isn&apos;t set — drafts won&apos;t generate until it is.
            </p>
          )}

          <Button size="sm" onClick={handleSave} disabled={saving}>
            {saving ? "Saving..." : "Save"}
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

