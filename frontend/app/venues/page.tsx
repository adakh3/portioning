"use client";

import { useEffect, useState } from "react";
import { api, Venue } from "@/lib/api";

export default function VenuesPage() {
  const [venues, setVenues] = useState<Venue[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [search, setSearch] = useState("");
  const [showForm, setShowForm] = useState(false);
  const [formData, setFormData] = useState<Partial<Venue>>({ name: "", city: "", kitchen_access: false });
  const [saving, setSaving] = useState(false);
  const [editingId, setEditingId] = useState<number | null>(null);

  useEffect(() => {
    api.getVenues()
      .then(setVenues)
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  }, []);

  const filtered = venues.filter(
    (v) => v.name.toLowerCase().includes(search.toLowerCase()) || v.city.toLowerCase().includes(search.toLowerCase())
  );

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    try {
      if (editingId) {
        const updated = await api.updateVenue(editingId, formData);
        setVenues((prev) => prev.map((v) => v.id === editingId ? updated : v));
        setEditingId(null);
      } else {
        const venue = await api.createVenue(formData);
        setVenues((prev) => [venue, ...prev]);
      }
      setShowForm(false);
      setFormData({ name: "", city: "", kitchen_access: false });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to save venue");
    } finally {
      setSaving(false);
    }
  }

  function startEdit(venue: Venue) {
    setFormData(venue);
    setEditingId(venue.id);
    setShowForm(true);
  }

  if (loading) return <p className="text-gray-500">Loading venues...</p>;
  if (error) return <p className="text-red-600">Error: {error}</p>;

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-2xl font-bold text-gray-900">Venues</h1>
        <button
          onClick={() => { setShowForm(!showForm); setEditingId(null); setFormData({ name: "", city: "", kitchen_access: false }); }}
          className="bg-blue-600 text-white px-4 py-2 rounded text-sm hover:bg-blue-700"
        >
          {showForm ? "Cancel" : "New Venue"}
        </button>
      </div>

      {showForm && (
        <form onSubmit={handleSubmit} className="bg-white border border-gray-200 rounded-lg p-4 mb-6">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Name</label>
              <input type="text" required value={formData.name || ""} onChange={(e) => setFormData({ ...formData, name: e.target.value })} className="w-full border border-gray-300 rounded px-3 py-2 text-sm focus:ring-1 focus:ring-blue-500" />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">City</label>
              <input type="text" value={formData.city || ""} onChange={(e) => setFormData({ ...formData, city: e.target.value })} className="w-full border border-gray-300 rounded px-3 py-2 text-sm" />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Contact Name</label>
              <input type="text" value={formData.contact_name || ""} onChange={(e) => setFormData({ ...formData, contact_name: e.target.value })} className="w-full border border-gray-300 rounded px-3 py-2 text-sm" />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Contact Phone</label>
              <input type="text" value={formData.contact_phone || ""} onChange={(e) => setFormData({ ...formData, contact_phone: e.target.value })} className="w-full border border-gray-300 rounded px-3 py-2 text-sm" />
            </div>
            <div className="flex items-center gap-2 mt-6">
              <input type="checkbox" checked={formData.kitchen_access || false} onChange={(e) => setFormData({ ...formData, kitchen_access: e.target.checked })} className="rounded border-gray-300" />
              <label className="text-sm text-gray-700">Kitchen access available</label>
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Loading Notes</label>
              <input type="text" value={formData.loading_notes || ""} onChange={(e) => setFormData({ ...formData, loading_notes: e.target.value })} className="w-full border border-gray-300 rounded px-3 py-2 text-sm" placeholder="Dock, access, parking..." />
            </div>
            <div className="md:col-span-2">
              <label className="block text-sm font-medium text-gray-700 mb-1">Rules / Restrictions</label>
              <textarea value={formData.rules || ""} onChange={(e) => setFormData({ ...formData, rules: e.target.value })} rows={2} className="w-full border border-gray-300 rounded px-3 py-2 text-sm" placeholder="Curfews, noise limits..." />
            </div>
          </div>
          <button type="submit" disabled={saving} className="mt-4 bg-green-600 text-white px-4 py-2 rounded text-sm hover:bg-green-700 disabled:opacity-50">
            {saving ? "Saving..." : editingId ? "Update Venue" : "Create Venue"}
          </button>
        </form>
      )}

      <input type="text" placeholder="Search venues..." value={search} onChange={(e) => setSearch(e.target.value)} className="w-full md:w-80 border border-gray-300 rounded px-3 py-2 text-sm mb-4" />

      {filtered.length === 0 ? (
        <p className="text-gray-500">No venues found.</p>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {filtered.map((venue) => (
            <div key={venue.id} className="bg-white border border-gray-200 rounded-lg p-4">
              <div className="flex items-start justify-between">
                <div>
                  <h3 className="font-semibold text-gray-900">{venue.name}</h3>
                  {venue.city && <p className="text-sm text-gray-500">{venue.city}</p>}
                </div>
                <button onClick={() => startEdit(venue)} className="text-blue-600 text-sm hover:underline">Edit</button>
              </div>
              <div className="mt-3 flex flex-wrap gap-2">
                {venue.kitchen_access && <span className="bg-green-100 text-green-700 text-xs px-2 py-0.5 rounded">Kitchen</span>}
                {venue.contact_name && <span className="text-xs text-gray-400">{venue.contact_name}</span>}
              </div>
              {venue.rules && <p className="text-xs text-gray-400 mt-2 truncate">{venue.rules}</p>}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
