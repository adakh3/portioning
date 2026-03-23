"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import { api, ProductLine } from "@/lib/api";
import { useSiteSettings, useProductLines, revalidate } from "@/lib/hooks";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ValidatedInput } from "@/components/ui/validated-input";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";

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

  if (loading) return <p className="text-muted-foreground">Loading settings...</p>;

  return (
    <div>
      <Button variant="link" asChild className="mb-4 p-0 h-auto">
        <Link href="/">&larr; Home</Link>
      </Button>
      <h1 className="text-2xl font-bold text-foreground mb-6">Settings</h1>

      {error && <p className="text-destructive mb-4">{error}</p>}
      {success && <p className="text-success mb-4">{success}</p>}

      <form onSubmit={handleSubmit} className="space-y-6 max-w-2xl">
        <Card>
          <CardHeader>
            <CardTitle>Currency</CardTitle>
          </CardHeader>
          <CardContent>
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
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Regional</CardTitle>
          </CardHeader>
          <CardContent>
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
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Pricing Defaults</CardTitle>
          </CardHeader>
          <CardContent>
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
          </CardContent>
        </Card>

        <Button type="submit" disabled={saving}>
          {saving ? "Saving..." : "Save Settings"}
        </Button>
      </form>

      {/* Product Line Colours */}
      <div className="space-y-6 max-w-2xl mt-8">
        <ProductLineColours />
      </div>

      {/* WhatsApp Integration */}
      <div className="space-y-6 max-w-2xl mt-8">
        <Card>
          <CardHeader>
            <div className="flex items-center justify-between">
              <CardTitle>WhatsApp</CardTitle>
              {settings?.twilio_configured ? (
                <Badge variant="success">Available</Badge>
              ) : (
                <Badge variant="secondary">Not available</Badge>
              )}
            </div>
          </CardHeader>
          <CardContent>
            {waError && <p className="text-destructive mb-3 text-sm">{waError}</p>}
            {waSuccess && <p className="text-success mb-3 text-sm">{waSuccess}</p>}
            {settings?.twilio_configured ? (
              <div className="space-y-3">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-sm font-medium text-foreground">WhatsApp Messaging</p>
                    <p className="text-xs text-muted-foreground">
                      Send messages to leads directly via WhatsApp.
                    </p>
                  </div>
                  <Button
                    variant={waEnabled ? "default" : "outline"}
                    size="sm"
                    onClick={() => handleWhatsAppToggle(!waEnabled)}
                    disabled={waSaving}
                  >
                    {waSaving ? "Saving..." : waEnabled ? "Enabled" : "Disabled"}
                  </Button>
                </div>
              </div>
            ) : (
              <p className="text-sm text-muted-foreground">
                WhatsApp messaging is not available. Contact your platform administrator to configure the messaging service.
              </p>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
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
