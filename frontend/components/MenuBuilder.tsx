"use client";

import { useEffect, useState, useMemo } from "react";
import { api, Dish, DishCategory, MenuTemplate, MenuTemplateDetail } from "@/lib/api";

interface Props {
  selectedDishIds: number[];
  basedOnTemplate: number | null;
  onSave?: (data: { dish_ids: number[]; based_on_template: number | null }) => Promise<void>;
  onChange?: (data: { dish_ids: number[]; based_on_template: number | null }) => void;
  onSuggestedPriceChange?: (price: number | null) => void;
  onUseSuggestedPrice?: (price: number) => void;
  currencySymbol?: string;
  disabled?: boolean;
}

export default function MenuBuilder({
  selectedDishIds,
  basedOnTemplate,
  onSave,
  onChange,
  onSuggestedPriceChange,
  onUseSuggestedPrice,
  currencySymbol = "£",
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

  // Template pricing from backend
  const [templatePrice, setTemplatePrice] = useState<number | null>(null);
  const [templateHasUnpriced, setTemplateHasUnpriced] = useState(false);
  // Whether user has modified dishes since loading template
  const [dishesModified, setDishesModified] = useState(false);

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

  // Compute suggested price from default portions (fallback when dishes modified)
  const computedPrice = useMemo(() => {
    const selectedDishes = dishes.filter((d) => selected.has(d.id));
    if (selectedDishes.length === 0) return null;

    let total = 0;
    let hasUnpriced = false;
    for (const dish of selectedDishes) {
      if (dish.selling_price_per_gram && parseFloat(dish.selling_price_per_gram) > 0) {
        total += parseFloat(dish.selling_price_per_gram) * dish.default_portion_grams;
      } else {
        hasUnpriced = true;
      }
    }
    if (total === 0) return null;
    return { price: Math.round(total * 100) / 100, hasUnpriced };
  }, [dishes, selected]);

  // Determine which price to show
  const suggestedPrice = useMemo(() => {
    if (!dishesModified && templatePrice !== null) {
      return { price: templatePrice, hasUnpriced: templateHasUnpriced, source: "template" as const };
    }
    if (computedPrice) {
      return { price: computedPrice.price, hasUnpriced: computedPrice.hasUnpriced, source: "default" as const };
    }
    return null;
  }, [dishesModified, templatePrice, templateHasUnpriced, computedPrice]);

  // Notify parent of price changes
  useEffect(() => {
    onSuggestedPriceChange?.(suggestedPrice?.price ?? null);
  }, [suggestedPrice?.price, onSuggestedPriceChange]);

  const toggleDish = (id: number) => {
    const next = new Set(selected);
    if (next.has(id)) {
      next.delete(id);
    } else {
      next.add(id);
    }
    setSelected(next);
    setDirty(true);
    setDishesModified(true);
    onChange?.({ dish_ids: Array.from(next), based_on_template: templateId });
  };

  const handleLoadTemplate = async (tid: number) => {
    try {
      const detail: MenuTemplateDetail = await api.getMenu(tid);
      const dishIds = detail.portions.map((p) => p.dish_id);
      setSelected(new Set(dishIds));
      setTemplateId(tid);
      setDirty(true);
      setDishesModified(false);
      // Use backend's suggested price from template
      setTemplatePrice(detail.suggested_price_per_head ?? null);
      setTemplateHasUnpriced(detail.has_unpriced_dishes ?? false);
      onChange?.({ dish_ids: dishIds, based_on_template: tid });
    } catch {
      // ignore
    }
  };

  const handleClearMenu = () => {
    setSelected(new Set());
    setTemplateId(null);
    setDirty(true);
    setDishesModified(true);
    setTemplatePrice(null);
    setTemplateHasUnpriced(false);
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
          type="button"
          onClick={() => setShowSelector(!showSelector)}
          disabled={disabled}
          className="border border-gray-300 text-gray-700 bg-white px-3 py-2 rounded text-sm font-medium hover:bg-gray-50 disabled:opacity-50"
        >
          {showSelector ? "Hide Dish Picker" : "Pick Individual Dishes"}
        </button>
        {selected.size > 0 && !disabled && (
          <button
            type="button"
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
                    type="button"
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

      {/* Pricing Summary Bar */}
      {suggestedPrice && (
        <div className="flex items-center gap-3 flex-wrap bg-green-50 border border-green-200 rounded-lg px-4 py-2.5">
          <span className="text-sm font-medium text-green-800">
            Estimated food price/head: {currencySymbol}{suggestedPrice.price.toFixed(2)}
          </span>
          {suggestedPrice.hasUnpriced && (
            <span className="inline-flex items-center bg-amber-100 text-amber-800 text-xs font-medium px-2 py-0.5 rounded">
              Some dishes unpriced
            </span>
          )}
          <span className="text-xs text-green-600">
            {suggestedPrice.source === "template"
              ? "(from template portions)"
              : "(based on default portions)"}
          </span>
          {onUseSuggestedPrice && (
            <button
              type="button"
              onClick={() => onUseSuggestedPrice(suggestedPrice.price)}
              className="ml-auto whitespace-nowrap border border-green-300 text-green-700 bg-white px-3 py-1 rounded text-sm font-medium hover:bg-green-100"
            >
              Use as price/head
            </button>
          )}
        </div>
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
                          type="button"
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
            type="button"
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
