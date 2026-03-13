"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import { api } from "@/lib/api";
import { useSiteSettings } from "@/lib/hooks";
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

  // WhatsApp form state (separate save)
  const [waForm, setWaForm] = useState({
    twilio_account_sid: "",
    twilio_auth_token: "",
    twilio_whatsapp_number: "",
    whatsapp_enabled: false,
  });
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
      setWaForm({
        twilio_account_sid: settings.twilio_account_sid || "",
        twilio_auth_token: "",
        twilio_whatsapp_number: settings.twilio_whatsapp_number || "",
        whatsapp_enabled: settings.whatsapp_enabled || false,
      });
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

  async function handleWhatsAppSave() {
    setWaSaving(true);
    setWaError("");
    setWaSuccess("");
    try {
      const payload: Record<string, unknown> = {
        twilio_account_sid: waForm.twilio_account_sid,
        twilio_whatsapp_number: waForm.twilio_whatsapp_number,
        whatsapp_enabled: waForm.whatsapp_enabled,
      };
      if (waForm.twilio_auth_token) {
        payload.twilio_auth_token = waForm.twilio_auth_token;
      }
      await api.updateSiteSettings(payload);
      mutateSettings();
      setWaForm((prev) => ({ ...prev, twilio_auth_token: "" }));
      setWaSuccess("WhatsApp settings saved.");
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
                  <option value="DD/MM/YYYY">DD/MM/YYYY (UK / Europe)</option>
                  <option value="MM/DD/YYYY">MM/DD/YYYY (US)</option>
                  <option value="YYYY-MM-DD">YYYY-MM-DD (ISO)</option>
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

      {/* WhatsApp Integration — separate save */}
      <div className="space-y-6 max-w-2xl mt-8">
        <Card>
          <CardHeader>
            <div className="flex items-center justify-between">
              <CardTitle>WhatsApp Integration</CardTitle>
              {settings?.twilio_configured ? (
                <Badge variant="success">Configured</Badge>
              ) : (
                <Badge variant="secondary">Not configured</Badge>
              )}
            </div>
          </CardHeader>
          <CardContent>
            {waError && <p className="text-destructive mb-3 text-sm">{waError}</p>}
            {waSuccess && <p className="text-success mb-3 text-sm">{waSuccess}</p>}
            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-foreground mb-1">Twilio Account SID</label>
                <Input
                  type="text"
                  value={waForm.twilio_account_sid}
                  onChange={(e) => setWaForm({ ...waForm, twilio_account_sid: e.target.value })}
                  placeholder="ACxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-foreground mb-1">
                  Twilio Auth Token {settings?.twilio_configured && "(leave blank to keep current)"}
                </label>
                <Input
                  type="password"
                  value={waForm.twilio_auth_token}
                  onChange={(e) => setWaForm({ ...waForm, twilio_auth_token: e.target.value })}
                  placeholder={settings?.twilio_configured ? "••••••••" : "Enter auth token"}
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-foreground mb-1">WhatsApp Sender Number</label>
                <Input
                  type="tel"
                  value={waForm.twilio_whatsapp_number}
                  onChange={(e) => setWaForm({ ...waForm, twilio_whatsapp_number: e.target.value })}
                  placeholder="+14155238886"
                />
                <p className="text-xs text-muted-foreground mt-1">
                  Your Twilio WhatsApp-enabled phone number (include country code).
                </p>
              </div>
              <div className="flex items-center gap-2">
                <input
                  type="checkbox"
                  id="whatsapp_enabled"
                  checked={waForm.whatsapp_enabled}
                  onChange={(e) => setWaForm({ ...waForm, whatsapp_enabled: e.target.checked })}
                  className="h-4 w-4 rounded border-input"
                />
                <label htmlFor="whatsapp_enabled" className="text-sm text-foreground">
                  Enable WhatsApp messaging
                </label>
              </div>
              <Button onClick={handleWhatsAppSave} disabled={waSaving}>
                {waSaving ? "Saving..." : "Save WhatsApp Settings"}
              </Button>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
