"use client";

import { useEffect, useState } from "react";
import { api, Dish, DishCategory, MenuTemplate, MenuTemplateDetail } from "@/lib/api";

interface Props {
  selectedDishIds: number[];
  basedOnTemplate: number | null;
  onSave?: (data: { dish_ids: number[]; based_on_template: number | null }) => Promise<void>;
  onChange?: (data: { dish_ids: number[]; based_on_template: number | null }) => void;
  disabled?: boolean;
}

export default function MenuBuilder({
  selectedDishIds,
  basedOnTemplate,
  onSave,
  onChange,
  disabled = false,
}: Props) {
  const [dishes, setDishes] = useState<Dish[]>([]);
  const [categories, setCategories] = useState<DishCategory[]>([]);
  const [templates, setTemplates] = useState<MenuTemplate[]>([]);
  const [loading, setLoading] = useState(true);

  const [selected, setSelected] = useState<Set<number>>(new Set(selectedDishIds));
  const [templateId, setTemplateId] = useState<number | null>(basedOnTemplate);
  const [saving, setSaving] = useState(false);
  const [search, setSearch] = useState("");
  const [showSelector, setShowSelector] = useState(false);

  // Track if changes have been made
  const [dirty, setDirty] = useState(false);

  useEffect(() => {
    Promise.all([api.getDishes(), api.getCategories(), api.getMenus()])
      .then(([d, c, t]) => {
        setDishes(d);
        setCategories(c);
        setTemplates(t);
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  // Sync with external prop changes
  useEffect(() => {
    setSelected(new Set(selectedDishIds));
    setTemplateId(basedOnTemplate);
    setDirty(false);
  }, [selectedDishIds, basedOnTemplate]);

  const toggleDish = (id: number) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      onChange?.({ dish_ids: Array.from(next), based_on_template: templateId });
      return next;
    });
    setDirty(true);
  };

  const handleLoadTemplate = async (tid: number) => {
    try {
      const detail: MenuTemplateDetail = await api.getMenu(tid);
      const dishIds = detail.portions.map((p) => p.dish_id);
      setSelected(new Set(dishIds));
      setTemplateId(tid);
      setDirty(true);
      onChange?.({ dish_ids: dishIds, based_on_template: tid });
    } catch {
      // ignore
    }
  };

  const handleClearMenu = () => {
    setSelected(new Set());
    setTemplateId(null);
    setDirty(true);
    onChange?.({ dish_ids: [], based_on_template: null });
  };

  const handleSave = async () => {
    if (!onSave) return;
    setSaving(true);
    try {
      await onSave({
        dish_ids: Array.from(selected),
        based_on_template: templateId,
      });
      setDirty(false);
    } finally {
      setSaving(false);
    }
  };

  // Get dish names for the current selection
  const selectedDishes = dishes.filter((d) => selected.has(d.id));
  const templateName = templates.find((t) => t.id === templateId)?.name;

  // Grouped dishes for selector
  const filtered = dishes.filter((d) =>
    d.name.toLowerCase().includes(search.toLowerCase())
  );
  const grouped = categories
    .sort((a, b) => a.display_order - b.display_order)
    .map((cat) => ({
      ...cat,
      dishes: filtered.filter((d) => d.category === cat.id),
    }))
    .filter((g) => g.dishes.length > 0);

  if (loading) {
    return <p className="text-sm text-gray-500">Loading menu options...</p>;
  }

  return (
    <div className="space-y-4">
      {/* Template Picker */}
      <div className="flex items-center gap-3 flex-wrap">
        <select
          value=""
          onChange={(e) => {
            if (e.target.value) handleLoadTemplate(Number(e.target.value));
          }}
          disabled={disabled}
          className="border border-gray-300 rounded-md px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:bg-gray-100"
        >
          <option value="">Load from template...</option>
          {templates.map((t) => (
            <option key={t.id} value={t.id}>
              {t.name} ({t.dish_count} dishes)
            </option>
          ))}
        </select>
        <button
          onClick={() => setShowSelector(!showSelector)}
          disabled={disabled}
          className="border border-gray-300 text-gray-700 bg-white px-3 py-2 rounded text-sm font-medium hover:bg-gray-50 disabled:opacity-50"
        >
          {showSelector ? "Hide Dish Picker" : "Pick Individual Dishes"}
        </button>
        {selected.size > 0 && !disabled && (
          <button
            onClick={handleClearMenu}
            className="text-red-600 text-sm hover:text-red-800"
          >
            Clear All
          </button>
        )}
      </div>

      {/* Template indicator */}
      {templateName && (
        <p className="text-xs text-gray-500">
          Based on template: <span className="font-medium">{templateName}</span>
        </p>
      )}

      {/* Current Menu (dish names only) */}
      {selectedDishes.length > 0 ? (
        <div>
          <h4 className="text-sm font-medium text-gray-700 mb-2">
            Menu ({selectedDishes.length} dishes)
          </h4>
          <div className="flex flex-wrap gap-2">
            {selectedDishes.map((dish) => (
              <span
                key={dish.id}
                className="inline-flex items-center gap-1.5 bg-blue-50 text-blue-800 border border-blue-200 px-2.5 py-1 rounded-full text-sm"
              >
                {dish.name}
                {dish.is_vegetarian && (
                  <span className="text-green-600 text-xs">V</span>
                )}
                {!disabled && (
                  <button
                    onClick={() => toggleDish(dish.id)}
                    className="text-blue-400 hover:text-blue-600 ml-0.5"
                    title="Remove"
                  >
                    &times;
                  </button>
                )}
              </span>
            ))}
          </div>
        </div>
      ) : (
        <p className="text-sm text-gray-500">
          No dishes selected. Load a template or pick dishes individually.
        </p>
      )}

      {/* Dish Selector (expandable) */}
      {showSelector && !disabled && (
        <div className="border border-gray-200 rounded-lg p-4 bg-gray-50">
          <div className="flex items-center justify-between mb-3">
            <h4 className="text-sm font-medium text-gray-700">
              Select Dishes ({selected.size} selected)
            </h4>
            <input
              type="text"
              placeholder="Search dishes..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="border border-gray-300 rounded px-3 py-1.5 text-sm w-48"
            />
          </div>
          <div className="space-y-3 max-h-72 overflow-y-auto">
            {grouped.map((group) => {
              const selectedInCat = group.dishes.filter((d) =>
                selected.has(d.id)
              ).length;
              return (
                <div key={group.id}>
                  <h5 className="text-xs font-medium text-gray-600 mb-1">
                    {group.display_name}
                    <span className="text-gray-400 ml-1">
                      ({selectedInCat}/{group.dishes.length})
                    </span>
                  </h5>
                  <div className="grid grid-cols-2 md:grid-cols-3 gap-1">
                    {group.dishes.map((dish) => {
                      const isSelected = selected.has(dish.id);
                      return (
                        <button
                          key={dish.id}
                          onClick={() => toggleDish(dish.id)}
                          className={`text-left text-sm px-2.5 py-1.5 rounded transition-colors ${
                            isSelected
                              ? "bg-blue-100 text-blue-800 border border-blue-300"
                              : "bg-white text-gray-700 border border-gray-200 hover:bg-gray-100"
                          }`}
                        >
                          {dish.name}
                          {dish.is_vegetarian && (
                            <span className="ml-1 text-green-600 text-xs">V</span>
                          )}
                        </button>
                      );
                    })}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Save button (only when onSave provided, not in onChange/creation mode) */}
      {dirty && !disabled && onSave && (
        <div className="flex justify-end">
          <button
            onClick={handleSave}
            disabled={saving}
            className="bg-blue-600 text-white px-4 py-2 rounded text-sm font-medium hover:bg-blue-700 disabled:opacity-50"
          >
            {saving ? "Saving..." : "Save Menu"}
          </button>
        </div>
      )}
    </div>
  );
}
