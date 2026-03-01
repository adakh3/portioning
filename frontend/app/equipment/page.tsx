"use client";

import { useEffect, useState } from "react";
import { api, EquipmentItem } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";

const CATEGORIES = [
  { value: "chafer", label: "Chafer / Warmer" },
  { value: "table", label: "Table" },
  { value: "linen", label: "Linen" },
  { value: "glassware", label: "Glassware" },
  { value: "cooking", label: "Cooking Equipment" },
  { value: "serving", label: "Serving Equipment" },
  { value: "decor", label: "Decor" },
  { value: "transport", label: "Transport" },
  { value: "other", label: "Other" },
] as const;

const CATEGORY_LABELS: Record<string, string> = Object.fromEntries(
  CATEGORIES.map((c) => [c.value, c.label])
);

export default function EquipmentPage() {
  const [equipment, setEquipment] = useState<EquipmentItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [search, setSearch] = useState("");
  const [categoryFilter, setCategoryFilter] = useState("");
  const [showForm, setShowForm] = useState(false);
  const [saving, setSaving] = useState(false);
  const [expandedId, setExpandedId] = useState<number | null>(null);
  const [formData, setFormData] = useState<Partial<EquipmentItem>>({
    name: "",
    category: "other",
    stock_quantity: 0,
    rental_price: "",
    description: "",
  });
  const [editFormData, setEditFormData] = useState<Partial<EquipmentItem>>({});

  useEffect(() => {
    api
      .getEquipment()
      .then(setEquipment)
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  }, []);

  const filtered = equipment.filter((item) => {
    const matchesSearch = item.name.toLowerCase().includes(search.toLowerCase());
    const matchesCategory = !categoryFilter || item.category === categoryFilter;
    return matchesSearch && matchesCategory;
  });

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    try {
      const item = await api.createEquipmentItem(formData);
      setEquipment((prev) => [item, ...prev]);
      setShowForm(false);
      setFormData({ name: "", category: "other", stock_quantity: 0, rental_price: "", description: "" });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to create equipment item");
    } finally {
      setSaving(false);
    }
  }

  async function handleUpdate(id: number, e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    try {
      const updated = await api.updateEquipmentItem(id, editFormData);
      setEquipment((prev) => prev.map((item) => (item.id === id ? updated : item)));
      setExpandedId(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to update equipment item");
    } finally {
      setSaving(false);
    }
  }

  function expandCard(item: EquipmentItem) {
    if (expandedId === item.id) {
      setExpandedId(null);
    } else {
      setEditFormData({
        name: item.name,
        category: item.category,
        stock_quantity: item.stock_quantity,
        rental_price: item.rental_price,
        description: item.description,
        replacement_cost: item.replacement_cost || "",
      });
      setExpandedId(item.id);
    }
  }

  if (loading) return <p className="text-muted-foreground">Loading equipment...</p>;
  if (error) return <p className="text-destructive">Error: {error}</p>;

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-2xl font-bold text-foreground">Equipment</h1>
        <Button
          onClick={() => {
            setShowForm(!showForm);
            setFormData({ name: "", category: "other", stock_quantity: 0, rental_price: "", description: "" });
          }}
        >
          {showForm ? "Cancel" : "Add Equipment"}
        </Button>
      </div>

      {showForm && (
        <form onSubmit={handleCreate} className="bg-background border border-border rounded-lg p-4 mb-6">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-foreground mb-1">Name *</label>
              <Input
                type="text"
                required
                value={formData.name || ""}
                onChange={(e) => setFormData({ ...formData, name: e.target.value })}
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-foreground mb-1">Category</label>
              <select
                value={formData.category || "other"}
                onChange={(e) => setFormData({ ...formData, category: e.target.value })}
                className="w-full border border-input rounded-md px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
              >
                {CATEGORIES.map((cat) => (
                  <option key={cat.value} value={cat.value}>
                    {cat.label}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-sm font-medium text-foreground mb-1">Stock Quantity</label>
              <Input
                type="number"
                min="0"
                value={formData.stock_quantity ?? 0}
                onChange={(e) => setFormData({ ...formData, stock_quantity: parseInt(e.target.value) || 0 })}
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-foreground mb-1">Rental Price</label>
              <Input
                type="number"
                step="0.01"
                value={formData.rental_price || ""}
                onChange={(e) => setFormData({ ...formData, rental_price: e.target.value })}
                placeholder="0.00"
              />
            </div>
            <div className="md:col-span-2">
              <label className="block text-sm font-medium text-foreground mb-1">Description</label>
              <Textarea
                value={formData.description || ""}
                onChange={(e) => setFormData({ ...formData, description: e.target.value })}
                rows={2}
              />
            </div>
          </div>
          <div className="flex gap-2 mt-4">
            <Button
              type="submit"
              disabled={saving}
              variant="success"
            >
              {saving ? "Saving..." : "Save"}
            </Button>
            <Button
              type="button"
              variant="outline"
              onClick={() => setShowForm(false)}
            >
              Cancel
            </Button>
          </div>
        </form>
      )}

      <div className="flex flex-col sm:flex-row gap-3 mb-4">
        <Input
          type="text"
          placeholder="Search equipment..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="w-full sm:w-80"
        />
        <select
          value={categoryFilter}
          onChange={(e) => setCategoryFilter(e.target.value)}
          className="w-full sm:w-56 border border-input rounded-md px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
        >
          <option value="">All Categories</option>
          {CATEGORIES.map((cat) => (
            <option key={cat.value} value={cat.value}>
              {cat.label}
            </option>
          ))}
        </select>
      </div>

      {filtered.length === 0 ? (
        <p className="text-muted-foreground">No equipment found.</p>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {filtered.map((item) => (
            <Card key={item.id}>
              <CardContent className="pt-4 pb-4">
                <div
                  className="cursor-pointer"
                  onClick={() => expandCard(item)}
                >
                  <div className="flex items-start justify-between">
                    <div>
                      <h3 className="font-semibold text-foreground">{item.name}</h3>
                      <Badge variant="secondary" className="mt-1">
                        {CATEGORY_LABELS[item.category] || item.category}
                      </Badge>
                    </div>
                    <Button
                      variant="link"
                      className="p-0 h-auto"
                      onClick={(e) => {
                        e.stopPropagation();
                        expandCard(item);
                      }}
                    >
                      {expandedId === item.id ? "Close" : "Edit"}
                    </Button>
                  </div>
                  <div className="flex items-center justify-between mt-3">
                    <span className="text-sm text-muted-foreground">
                      Stock: <span className="font-medium text-foreground">{item.stock_quantity}</span>
                    </span>
                    {item.rental_price && (
                      <span className="text-sm font-medium text-foreground">
                        {"\u00A3"}{parseFloat(item.rental_price).toFixed(2)}/event
                      </span>
                    )}
                  </div>
                </div>

                {expandedId === item.id && (
                  <form
                    onSubmit={(e) => handleUpdate(item.id, e)}
                    className="mt-4 pt-4 border-t border-border"
                  >
                    <div className="grid grid-cols-1 gap-3">
                      <div>
                        <label className="block text-sm font-medium text-foreground mb-1">Name *</label>
                        <Input
                          type="text"
                          required
                          value={editFormData.name || ""}
                          onChange={(e) =>
                            setEditFormData({ ...editFormData, name: e.target.value })
                          }
                        />
                      </div>
                      <div>
                        <label className="block text-sm font-medium text-foreground mb-1">Category</label>
                        <select
                          value={editFormData.category || "other"}
                          onChange={(e) =>
                            setEditFormData({ ...editFormData, category: e.target.value })
                          }
                          className="w-full border border-input rounded-md px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                        >
                          {CATEGORIES.map((cat) => (
                            <option key={cat.value} value={cat.value}>
                              {cat.label}
                            </option>
                          ))}
                        </select>
                      </div>
                      <div className="grid grid-cols-2 gap-3">
                        <div>
                          <label className="block text-sm font-medium text-foreground mb-1">Stock Qty</label>
                          <Input
                            type="number"
                            min="0"
                            value={editFormData.stock_quantity ?? 0}
                            onChange={(e) =>
                              setEditFormData({
                                ...editFormData,
                                stock_quantity: parseInt(e.target.value) || 0,
                              })
                            }
                          />
                        </div>
                        <div>
                          <label className="block text-sm font-medium text-foreground mb-1">Rental Price</label>
                          <Input
                            type="number"
                            step="0.01"
                            value={editFormData.rental_price || ""}
                            onChange={(e) =>
                              setEditFormData({ ...editFormData, rental_price: e.target.value })
                            }
                            placeholder="0.00"
                          />
                        </div>
                      </div>
                      <div>
                        <label className="block text-sm font-medium text-foreground mb-1">
                          Replacement Cost
                        </label>
                        <Input
                          type="number"
                          step="0.01"
                          value={editFormData.replacement_cost || ""}
                          onChange={(e) =>
                            setEditFormData({ ...editFormData, replacement_cost: e.target.value })
                          }
                          placeholder="0.00"
                        />
                      </div>
                      <div>
                        <label className="block text-sm font-medium text-foreground mb-1">Description</label>
                        <Textarea
                          value={editFormData.description || ""}
                          onChange={(e) =>
                            setEditFormData({ ...editFormData, description: e.target.value })
                          }
                          rows={2}
                        />
                      </div>
                    </div>
                    <div className="flex gap-2 mt-4">
                      <Button
                        type="submit"
                        disabled={saving}
                        variant="success"
                      >
                        {saving ? "Saving..." : "Save"}
                      </Button>
                      <Button
                        type="button"
                        variant="outline"
                        onClick={() => setExpandedId(null)}
                      >
                        Cancel
                      </Button>
                    </div>
                  </form>
                )}
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
