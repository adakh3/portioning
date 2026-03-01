"use client";

import { useEffect, useState } from "react";
import { api, Venue } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";

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

  if (loading) return <p className="text-muted-foreground">Loading venues...</p>;
  if (error) return <p className="text-destructive">Error: {error}</p>;

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-2xl font-bold text-foreground">Venues</h1>
        <Button
          onClick={() => { setShowForm(!showForm); setEditingId(null); setFormData({ name: "", city: "", kitchen_access: false }); }}
        >
          {showForm ? "Cancel" : "New Venue"}
        </Button>
      </div>

      {showForm && (
        <form onSubmit={handleSubmit} className="bg-background border border-border rounded-lg p-4 mb-6">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-foreground mb-1">Name</label>
              <Input type="text" required value={formData.name || ""} onChange={(e) => setFormData({ ...formData, name: e.target.value })} />
            </div>
            <div>
              <label className="block text-sm font-medium text-foreground mb-1">City</label>
              <Input type="text" value={formData.city || ""} onChange={(e) => setFormData({ ...formData, city: e.target.value })} />
            </div>
            <div>
              <label className="block text-sm font-medium text-foreground mb-1">Contact Name</label>
              <Input type="text" value={formData.contact_name || ""} onChange={(e) => setFormData({ ...formData, contact_name: e.target.value })} />
            </div>
            <div>
              <label className="block text-sm font-medium text-foreground mb-1">Contact Phone</label>
              <Input type="text" value={formData.contact_phone || ""} onChange={(e) => setFormData({ ...formData, contact_phone: e.target.value })} />
            </div>
            <div className="flex items-center gap-2 mt-6">
              <input type="checkbox" checked={formData.kitchen_access || false} onChange={(e) => setFormData({ ...formData, kitchen_access: e.target.checked })} className="rounded border-input" />
              <label className="text-sm text-foreground">Kitchen access available</label>
            </div>
            <div>
              <label className="block text-sm font-medium text-foreground mb-1">Loading Notes</label>
              <Input type="text" value={formData.loading_notes || ""} onChange={(e) => setFormData({ ...formData, loading_notes: e.target.value })} placeholder="Dock, access, parking..." />
            </div>
            <div className="md:col-span-2">
              <label className="block text-sm font-medium text-foreground mb-1">Rules / Restrictions</label>
              <Textarea value={formData.rules || ""} onChange={(e) => setFormData({ ...formData, rules: e.target.value })} rows={2} placeholder="Curfews, noise limits..." />
            </div>
          </div>
          <Button type="submit" disabled={saving} variant="success" className="mt-4">
            {saving ? "Saving..." : editingId ? "Update Venue" : "Create Venue"}
          </Button>
        </form>
      )}

      <Input type="text" placeholder="Search venues..." value={search} onChange={(e) => setSearch(e.target.value)} className="w-full md:w-80 mb-4" />

      {filtered.length === 0 ? (
        <p className="text-muted-foreground">No venues found.</p>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {filtered.map((venue) => (
            <Card key={venue.id}>
              <CardContent className="pt-4 pb-4">
                <div className="flex items-start justify-between">
                  <div>
                    <h3 className="font-semibold text-foreground">{venue.name}</h3>
                    {venue.city && <p className="text-sm text-muted-foreground">{venue.city}</p>}
                  </div>
                  <Button variant="link" className="p-0 h-auto" onClick={() => startEdit(venue)}>Edit</Button>
                </div>
                <div className="mt-3 flex flex-wrap gap-2">
                  {venue.kitchen_access && <Badge variant="success">Kitchen</Badge>}
                  {venue.contact_name && <span className="text-xs text-muted-foreground">{venue.contact_name}</span>}
                </div>
                {venue.rules && <p className="text-xs text-muted-foreground mt-2 truncate">{venue.rules}</p>}
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
