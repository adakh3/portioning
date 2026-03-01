"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import { api, SiteSettingsData } from "@/lib/api";

export default function SettingsPage() {
  const [settings, setSettings] = useState<SiteSettingsData | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");

  const [formData, setFormData] = useState({
    currency_symbol: "",
    currency_code: "",
    default_price_per_head: "",
    target_food_cost_percentage: "",
  });

  useEffect(() => {
    api.getSiteSettings()
      .then((s) => {
        setSettings(s);
        setFormData({
          currency_symbol: s.currency_symbol,
          currency_code: s.currency_code,
          default_price_per_head: s.default_price_per_head,
          target_food_cost_percentage: s.target_food_cost_percentage,
        });
      })
      .catch((e) => setError(e instanceof Error ? e.message : "Failed to load settings"))
      .finally(() => setLoading(false));
  }, []);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    setError("");
    setSuccess("");
    try {
      const updated = await api.updateSiteSettings(formData);
      setSettings(updated);
      setSuccess("Settings saved successfully.");
      setTimeout(() => setSuccess(""), 3000);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to save settings");
    } finally {
      setSaving(false);
    }
  }

  if (loading) return <p className="text-gray-500">Loading settings...</p>;

  return (
    <div>
      <Link href="/" className="text-sm text-blue-600 hover:underline mb-4 inline-block">&larr; Home</Link>
      <h1 className="text-2xl font-bold text-gray-900 mb-6">Settings</h1>

      {error && <p className="text-red-600 mb-4">{error}</p>}
      {success && <p className="text-green-600 mb-4">{success}</p>}

      <form onSubmit={handleSubmit} className="space-y-6 max-w-2xl">
        <div className="bg-white border border-gray-200 rounded-lg p-6">
          <h2 className="text-lg font-semibold text-gray-900 mb-4">Currency</h2>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Currency Symbol</label>
              <input
                type="text"
                value={formData.currency_symbol}
                onChange={(e) => setFormData({ ...formData, currency_symbol: e.target.value })}
                className="w-full border border-gray-300 rounded px-3 py-2 text-sm"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Currency Code</label>
              <input
                type="text"
                value={formData.currency_code}
                onChange={(e) => setFormData({ ...formData, currency_code: e.target.value })}
                className="w-full border border-gray-300 rounded px-3 py-2 text-sm"
              />
            </div>
          </div>
        </div>

        <div className="bg-white border border-gray-200 rounded-lg p-6">
          <h2 className="text-lg font-semibold text-gray-900 mb-4">Pricing Defaults</h2>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Default Price Per Head ({formData.currency_symbol})</label>
              <input
                type="number"
                step="0.01"
                min="0"
                value={formData.default_price_per_head}
                onChange={(e) => setFormData({ ...formData, default_price_per_head: e.target.value })}
                className="w-full border border-gray-300 rounded px-3 py-2 text-sm"
              />
              <p className="text-xs text-gray-500 mt-1">
                Pre-filled when creating new quotes and events. Set to 0 to leave blank.
              </p>
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Target Food Cost %</label>
              <input
                type="number"
                step="0.01"
                min="0"
                max="100"
                value={formData.target_food_cost_percentage}
                onChange={(e) => setFormData({ ...formData, target_food_cost_percentage: e.target.value })}
                className="w-full border border-gray-300 rounded px-3 py-2 text-sm"
              />
              <p className="text-xs text-gray-500 mt-1">
                Used to calculate selling prices from food costs. For example, if food cost is {formData.currency_symbol}3.00
                and target food cost is 30%, the suggested selling price would be {formData.currency_symbol}10.00/head.
              </p>
            </div>
          </div>
        </div>

        <button type="submit" disabled={saving} className="bg-blue-600 text-white px-6 py-2 rounded text-sm font-medium hover:bg-blue-700 disabled:opacity-50">
          {saving ? "Saving..." : "Save Settings"}
        </button>
      </form>
    </div>
  );
}
