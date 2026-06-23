"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import { api, ProductLine, SiteSettingsData } from "@/lib/api";
import { useSiteSettings, useProductLines, revalidate } from "@/lib/hooks";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ValidatedInput } from "@/components/ui/validated-input";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import LeadStatusesSettings from "@/components/LeadStatusesSettings";
import ChoiceOptionsSettings from "@/components/ChoiceOptionsSettings";

export default function SettingsPage() {
  const { data: settings, isLoading: loading, mutate: mutateSettings } = useSiteSettings();
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");

  const [formData, setFormData] = useState({
    currency_symbol: "",
    currency_code: "",
    date_format: "DD/MM/YYYY",
    default_price_per_head: "",
    target_food_cost_percentage: "",
    price_rounding_step: "50",
    quotation_terms: "",
  });

  // WhatsApp toggle state (separate save)
  const [waEnabled, setWaEnabled] = useState(false);
  const [waSaving, setWaSaving] = useState(false);
  const [waError, setWaError] = useState("");
  const [waSuccess, setWaSuccess] = useState("");

  useEffect(() => {
    if (settings) {
      setFormData({
        currency_symbol: settings.currency_symbol,
        currency_code: settings.currency_code,
        date_format: settings.date_format || "DD/MM/YYYY",
        default_price_per_head: settings.default_price_per_head,
        target_food_cost_percentage: settings.target_food_cost_percentage,
        price_rounding_step: settings.price_rounding_step || "50",
        quotation_terms: settings.quotation_terms || "",
      });
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

  const baseline = settings && {
    currency_symbol: settings.currency_symbol,
    currency_code: settings.currency_code,
    date_format: settings.date_format || "DD/MM/YYYY",
    default_price_per_head: settings.default_price_per_head,
    target_food_cost_percentage: settings.target_food_cost_percentage,
    price_rounding_step: settings.price_rounding_step || "50",
    quotation_terms: settings.quotation_terms || "",
  };
  const dirty = baseline ? JSON.stringify(baseline) !== JSON.stringify(formData) : false;

  if (loading) return <p className="text-muted-foreground">Loading settings...</p>;

  return (
    <div>
      <Button variant="link" asChild className="mb-4 p-0 h-auto">
        <Link href="/">&larr; Home</Link>
      </Button>
      <h1 className="text-2xl font-bold text-foreground mb-6">Settings</h1>


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

      {/* Lead Statuses */}
      <div className="space-y-6 max-w-2xl mt-8">
        <LeadStatusesSettings />
      </div>

      {/* Other org choice lists */}
      <div className="space-y-6 max-w-2xl mt-8">
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

      {/* Product Line Colours */}
      <div className="space-y-6 max-w-2xl mt-8">
        <ProductLineColours />
      </div>

      {/* WhatsApp Integration */}
      <div className="space-y-6 max-w-2xl mt-8">
        <WhatsAppSettings settings={settings} onSave={() => mutateSettings()} />
      </div>
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

const DEFAULT_PALETTE = ["#EF4444", "#F59E0B", "#10B981", "#3B82F6", "#8B5CF6", "#EC4899", "#6366F1", "#14B8A6"];

function ProductLineColours() {
  const { data: productLines = [], mutate } = useProductLines();
  const [saving, setSaving] = useState<number | null>(null);

  async function handleColourChange(pl: ProductLine, colour: string) {
    setSaving(pl.id);
    try {
      await api.updateProductLine(pl.id, { colour });
      revalidate("product-lines");
      mutate();
    } catch { /* silently fail */ }
    finally { setSaving(null); }
  }

  if (productLines.length === 0) return null;

  return (
    <Card>
      <CardHeader>
        <CardTitle>Product Line Colours</CardTitle>
      </CardHeader>
      <CardContent>
        <p className="text-xs text-muted-foreground mb-4">
          Colours are used on the calendar and lead kanban to visually distinguish products.
        </p>
        <div className="space-y-3">
          {productLines.map((pl) => (
            <div key={pl.id} className="flex items-center gap-3">
              <input
                type="color"
                value={pl.colour || "#6B7280"}
                onChange={(e) => handleColourChange(pl, e.target.value)}
                disabled={saving === pl.id}
                className="h-9 w-9 rounded-md border border-input cursor-pointer p-0.5"
              />
              <span className="text-sm text-foreground">{pl.name}</span>
              {saving === pl.id && (
                <span className="text-xs text-muted-foreground">Saving...</span>
              )}
              <div className="flex gap-1 ml-auto">
                {DEFAULT_PALETTE.map((c) => (
                  <button
                    key={c}
                    onClick={() => handleColourChange(pl, c)}
                    className="h-5 w-5 rounded-full border border-border hover:ring-2 hover:ring-ring transition-shadow"
                    style={{ backgroundColor: c }}
                    title={c}
                  />
                ))}
              </div>
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}
