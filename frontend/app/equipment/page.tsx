"use client";

import { useEffect, useState } from "react";
import { api, EquipmentItem } from "@/lib/api";

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

  if (loading) return <p className="text-gray-500">Loading equipment...</p>;
  if (error) return <p className="text-red-600">Error: {error}</p>;

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-2xl font-bold text-gray-900">Equipment</h1>
        <button
          onClick={() => {
            setShowForm(!showForm);
            setFormData({ name: "", category: "other", stock_quantity: 0, rental_price: "", description: "" });
          }}
          className="bg-blue-600 text-white px-4 py-2 rounded text-sm hover:bg-blue-700"
        >
          {showForm ? "Cancel" : "Add Equipment"}
        </button>
      </div>

      {showForm && (
        <form onSubmit={handleCreate} className="bg-white border border-gray-200 rounded-lg p-4 mb-6">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Name *</label>
              <input
                type="text"
                required
                value={formData.name || ""}
                onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                className="w-full border border-gray-300 rounded px-3 py-2 text-sm focus:ring-1 focus:ring-blue-500"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Category</label>
              <select
                value={formData.category || "other"}
                onChange={(e) => setFormData({ ...formData, category: e.target.value })}
                className="w-full border border-gray-300 rounded px-3 py-2 text-sm focus:ring-1 focus:ring-blue-500"
              >
                {CATEGORIES.map((cat) => (
                  <option key={cat.value} value={cat.value}>
                    {cat.label}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Stock Quantity</label>
              <input
                type="number"
                min="0"
                value={formData.stock_quantity ?? 0}
                onChange={(e) => setFormData({ ...formData, stock_quantity: parseInt(e.target.value) || 0 })}
                className="w-full border border-gray-300 rounded px-3 py-2 text-sm focus:ring-1 focus:ring-blue-500"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Rental Price</label>
              <input
                type="number"
                step="0.01"
                value={formData.rental_price || ""}
                onChange={(e) => setFormData({ ...formData, rental_price: e.target.value })}
                className="w-full border border-gray-300 rounded px-3 py-2 text-sm focus:ring-1 focus:ring-blue-500"
                placeholder="0.00"
              />
            </div>
            <div className="md:col-span-2">
              <label className="block text-sm font-medium text-gray-700 mb-1">Description</label>
              <textarea
                value={formData.description || ""}
                onChange={(e) => setFormData({ ...formData, description: e.target.value })}
                rows={2}
                className="w-full border border-gray-300 rounded px-3 py-2 text-sm focus:ring-1 focus:ring-blue-500"
              />
            </div>
          </div>
          <div className="flex gap-2 mt-4">
            <button
              type="submit"
              disabled={saving}
              className="bg-green-600 text-white px-4 py-2 rounded text-sm hover:bg-green-700 disabled:opacity-50"
            >
              {saving ? "Saving..." : "Save"}
            </button>
            <button
              type="button"
              onClick={() => setShowForm(false)}
              className="border border-gray-300 text-gray-700 px-4 py-2 rounded text-sm hover:bg-gray-50"
            >
              Cancel
            </button>
          </div>
        </form>
      )}

      <div className="flex flex-col sm:flex-row gap-3 mb-4">
        <input
          type="text"
          placeholder="Search equipment..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="w-full sm:w-80 border border-gray-300 rounded px-3 py-2 text-sm focus:ring-1 focus:ring-blue-500"
        />
        <select
          value={categoryFilter}
          onChange={(e) => setCategoryFilter(e.target.value)}
          className="w-full sm:w-56 border border-gray-300 rounded px-3 py-2 text-sm focus:ring-1 focus:ring-blue-500"
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
        <p className="text-gray-500">No equipment found.</p>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {filtered.map((item) => (
            <div key={item.id} className="bg-white border border-gray-200 rounded-lg p-4">
              <div
                className="cursor-pointer"
                onClick={() => expandCard(item)}
              >
                <div className="flex items-start justify-between">
                  <div>
                    <h3 className="font-semibold text-gray-900">{item.name}</h3>
                    <span className="inline-block mt-1 bg-purple-100 text-purple-700 text-xs px-2 py-0.5 rounded">
                      {CATEGORY_LABELS[item.category] || item.category}
                    </span>
                  </div>
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      expandCard(item);
                    }}
                    className="text-blue-600 text-sm hover:underline"
                  >
                    {expandedId === item.id ? "Close" : "Edit"}
                  </button>
                </div>
                <div className="flex items-center justify-between mt-3">
                  <span className="text-sm text-gray-600">
                    Stock: <span className="font-medium text-gray-900">{item.stock_quantity}</span>
                  </span>
                  {item.rental_price && (
                    <span className="text-sm font-medium text-gray-700">
                      {"\u00A3"}{parseFloat(item.rental_price).toFixed(2)}/event
                    </span>
                  )}
                </div>
              </div>

              {expandedId === item.id && (
                <form
                  onSubmit={(e) => handleUpdate(item.id, e)}
                  className="mt-4 pt-4 border-t border-gray-100"
                >
                  <div className="grid grid-cols-1 gap-3">
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-1">Name *</label>
                      <input
                        type="text"
                        required
                        value={editFormData.name || ""}
                        onChange={(e) =>
                          setEditFormData({ ...editFormData, name: e.target.value })
                        }
                        className="w-full border border-gray-300 rounded px-3 py-2 text-sm focus:ring-1 focus:ring-blue-500"
                      />
                    </div>
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-1">Category</label>
                      <select
                        value={editFormData.category || "other"}
                        onChange={(e) =>
                          setEditFormData({ ...editFormData, category: e.target.value })
                        }
                        className="w-full border border-gray-300 rounded px-3 py-2 text-sm focus:ring-1 focus:ring-blue-500"
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
                        <label className="block text-sm font-medium text-gray-700 mb-1">Stock Qty</label>
                        <input
                          type="number"
                          min="0"
                          value={editFormData.stock_quantity ?? 0}
                          onChange={(e) =>
                            setEditFormData({
                              ...editFormData,
                              stock_quantity: parseInt(e.target.value) || 0,
                            })
                          }
                          className="w-full border border-gray-300 rounded px-3 py-2 text-sm focus:ring-1 focus:ring-blue-500"
                        />
                      </div>
                      <div>
                        <label className="block text-sm font-medium text-gray-700 mb-1">Rental Price</label>
                        <input
                          type="number"
                          step="0.01"
                          value={editFormData.rental_price || ""}
                          onChange={(e) =>
                            setEditFormData({ ...editFormData, rental_price: e.target.value })
                          }
                          className="w-full border border-gray-300 rounded px-3 py-2 text-sm focus:ring-1 focus:ring-blue-500"
                          placeholder="0.00"
                        />
                      </div>
                    </div>
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-1">
                        Replacement Cost
                      </label>
                      <input
                        type="number"
                        step="0.01"
                        value={editFormData.replacement_cost || ""}
                        onChange={(e) =>
                          setEditFormData({ ...editFormData, replacement_cost: e.target.value })
                        }
                        className="w-full border border-gray-300 rounded px-3 py-2 text-sm focus:ring-1 focus:ring-blue-500"
                        placeholder="0.00"
                      />
                    </div>
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-1">Description</label>
                      <textarea
                        value={editFormData.description || ""}
                        onChange={(e) =>
                          setEditFormData({ ...editFormData, description: e.target.value })
                        }
                        rows={2}
                        className="w-full border border-gray-300 rounded px-3 py-2 text-sm focus:ring-1 focus:ring-blue-500"
                      />
                    </div>
                  </div>
                  <div className="flex gap-2 mt-4">
                    <button
                      type="submit"
                      disabled={saving}
                      className="bg-green-600 text-white px-4 py-2 rounded text-sm hover:bg-green-700 disabled:opacity-50"
                    >
                      {saving ? "Saving..." : "Save"}
                    </button>
                    <button
                      type="button"
                      onClick={() => setExpandedId(null)}
                      className="border border-gray-300 text-gray-700 px-4 py-2 rounded text-sm hover:bg-gray-50"
                    >
                      Cancel
                    </button>
                  </div>
                </form>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
