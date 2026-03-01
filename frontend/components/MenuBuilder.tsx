"use client";

import { useEffect, useState, useMemo } from "react";
import { api, Dish, DishCategory, MenuTemplate, MenuTemplateDetail, PriceTier, PriceCheckResult, PriceCheckBreakdownItem, PriceEstimateResult } from "@/lib/api";

interface CalculatedPrice {
  price: number;
  source: "tier" | "template_adjusted" | "computed";
  tierLabel?: string;
  breakdown?: PriceCheckBreakdownItem[];
  totalAdjustment?: number;
  hasUnpriced: boolean;
}

function roundToStep(value: number, step: number): number {
  if (step <= 1) return value;
  return Math.round(value / step) * step;
}

interface Props {
  selectedDishIds: number[];
  basedOnTemplate: number | null;
  guestCount?: number;
  onSave?: (data: { dish_ids: number[]; based_on_template: number | null }) => Promise<void>;
  onChange?: (data: { dish_ids: number[]; based_on_template: number | null }) => void;
  onSuggestedPriceChange?: (price: number | null) => void;
  onUseSuggestedPrice?: (price: number) => void;
  currencySymbol?: string;
  disabled?: boolean;
  priceRoundingStep?: number;
}

export default function MenuBuilder({
  selectedDishIds,
  basedOnTemplate,
  guestCount,
  onSave,
  onChange,
  onSuggestedPriceChange,
  onUseSuggestedPrice,
  currencySymbol = "£",
  disabled = false,
  priceRoundingStep = 1,
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

  // Template pricing state
  const [templatePriceTiers, setTemplatePriceTiers] = useState<PriceTier[]>([]);
  const [originalDishIds, setOriginalDishIds] = useState<Set<number>>(new Set());
  // Whether user has modified dishes since loading template
  const [dishesModified, setDishesModified] = useState(false);

  // Calculate Rate state
  const [calculatedPrice, setCalculatedPrice] = useState<CalculatedPrice | null>(null);
  const [priceLoading, setPriceLoading] = useState(false);

  // Extra food % markup
  const [extraFoodPercent, setExtraFoodPercent] = useState(0);

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

  // Client-side tier selection (no API) for unmodified template + guest count
  const tierPrice = useMemo(() => {
    if (!guestCount || !templateId || dishesModified || templatePriceTiers.length === 0) return null;
    const matching = templatePriceTiers
      .filter((t) => t.min_guests <= guestCount)
      .sort((a, b) => b.min_guests - a.min_guests);
    if (matching.length === 0) return null;
    const tier = matching[0];
    return {
      price: roundToStep(parseFloat(tier.price_per_head), priceRoundingStep),
      label: `${tier.min_guests}+ pax`,
    };
  }, [guestCount, templateId, dishesModified, templatePriceTiers, priceRoundingStep]);

  // Apply extra food % markup to a base price
  const applyExtra = (base: number) => {
    const marked = base * (1 + extraFoodPercent / 100);
    return roundToStep(marked, priceRoundingStep);
  };

  // Determine active price for parent notification
  const activePrice = useMemo(() => {
    if (tierPrice) return applyExtra(tierPrice.price);
    if (calculatedPrice) return applyExtra(calculatedPrice.price);
    return null;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tierPrice, calculatedPrice, extraFoodPercent]);

  // Notify parent of price changes
  useEffect(() => {
    onSuggestedPriceChange?.(activePrice);
  }, [activePrice, onSuggestedPriceChange]);

  // Reset calculated price when dishes change
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
    setCalculatedPrice(null);
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
      setTemplatePriceTiers(detail.price_tiers || []);
      setOriginalDishIds(new Set(dishIds));
      setCalculatedPrice(null);
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
    setTemplatePriceTiers([]);
    setOriginalDishIds(new Set());
    setCalculatedPrice(null);
    onChange?.({ dish_ids: [], based_on_template: null });
  };

  const handleCalculateRate = async () => {
    if (!guestCount || selected.size === 0) return;
    setPriceLoading(true);
    try {
      const dishIds = Array.from(selected);
      if (templateId && dishesModified) {
        // Template with modifications — use price-check endpoint
        const result: PriceCheckResult = await api.menuPriceCheck(templateId, {
          guest_count: guestCount,
          dish_ids: dishIds,
        });
        setCalculatedPrice({
          price: roundToStep(result.adjusted_price, priceRoundingStep),
          source: "template_adjusted",
          tierLabel: result.tier_label,
          breakdown: result.breakdown,
          totalAdjustment: result.total_adjustment,
          hasUnpriced: false,
        });
      } else {
        // Custom menu — use price-estimate endpoint
        const result: PriceEstimateResult = await api.priceEstimate({
          dish_ids: dishIds,
          guest_count: guestCount,
        });
        setCalculatedPrice({
          price: roundToStep(result.price_per_head, priceRoundingStep),
          source: "computed",
          hasUnpriced: result.has_unpriced,
        });
      }
    } catch {
      // ignore
    } finally {
      setPriceLoading(false);
    }
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

  // Determine pricing bar state
  const hasDishes = selected.size > 0;
  const hasGuestCount = !!guestCount && guestCount > 0;
  const isTemplate = !!templateId;
  const showTierPrice = hasGuestCount && isTemplate && !dishesModified && tierPrice !== null;
  const showCalculateButton = hasGuestCount && hasDishes && !showTierPrice;

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
      {hasDishes && (
        <>
          {!hasGuestCount ? (
            /* No guest count */
            <div className="flex items-center gap-3 bg-gray-50 border border-gray-200 rounded-lg px-4 py-2.5">
              <span className="text-sm text-gray-500">
                Enter guest count to see pricing
              </span>
            </div>
          ) : showTierPrice && tierPrice ? (
            /* Template, unmodified, has tier */
            <div className="flex items-center gap-3 flex-wrap bg-green-50 border border-green-200 rounded-lg px-4 py-2.5">
              <span className="text-sm font-medium text-green-800">
                {currencySymbol}{applyExtra(tierPrice.price).toLocaleString()}/head
              </span>
              <span className="text-xs text-green-600">
                ({tierPrice.label} tier)
              </span>
              <label className="inline-flex items-center gap-1.5 text-xs text-gray-600">
                Extra food
                <input
                  type="number"
                  min={0}
                  max={100}
                  step={5}
                  value={extraFoodPercent || ""}
                  onChange={(e) => setExtraFoodPercent(Number(e.target.value) || 0)}
                  placeholder="0"
                  className="w-14 border border-gray-300 rounded px-1.5 py-0.5 text-xs text-center"
                />
                %
              </label>
              {onUseSuggestedPrice && (
                <button
                  type="button"
                  onClick={() => onUseSuggestedPrice(applyExtra(tierPrice.price))}
                  className="ml-auto whitespace-nowrap border border-green-300 text-green-700 bg-white px-3 py-1 rounded text-sm font-medium hover:bg-green-100"
                >
                  Use as price/head
                </button>
              )}
            </div>
          ) : showCalculateButton ? (
            /* Need to calculate */
            <div className="flex items-center gap-3 flex-wrap bg-gray-50 border border-gray-200 rounded-lg px-4 py-2.5">
              {calculatedPrice ? (
                <div className="flex flex-col gap-1.5 w-full">
                  <div className="flex items-center gap-3 flex-wrap">
                    <span className="text-sm font-medium text-green-800">
                      {currencySymbol}{applyExtra(calculatedPrice.price).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}/head
                    </span>
                    {calculatedPrice.hasUnpriced && (
                      <span className="inline-flex items-center bg-amber-100 text-amber-800 text-xs font-medium px-2 py-0.5 rounded">
                        Some dishes unpriced
                      </span>
                    )}
                    {calculatedPrice.source === "template_adjusted" && (
                      <span className="text-xs text-green-600">
                        ({calculatedPrice.tierLabel} tier {calculatedPrice.totalAdjustment !== undefined && calculatedPrice.totalAdjustment >= 0 ? "+" : ""}{currencySymbol}{calculatedPrice.totalAdjustment?.toFixed(2)})
                      </span>
                    )}
                    {calculatedPrice.source === "computed" && (
                      <span className="text-xs text-green-600">(computed from engine)</span>
                    )}
                    <label className="inline-flex items-center gap-1.5 text-xs text-gray-600">
                      Extra food
                      <input
                        type="number"
                        min={0}
                        max={100}
                        step={5}
                        value={extraFoodPercent || ""}
                        onChange={(e) => setExtraFoodPercent(Number(e.target.value) || 0)}
                        placeholder="0"
                        className="w-14 border border-gray-300 rounded px-1.5 py-0.5 text-xs text-center"
                      />
                      %
                    </label>
                    {onUseSuggestedPrice && (
                      <button
                        type="button"
                        onClick={() => onUseSuggestedPrice(applyExtra(calculatedPrice.price))}
                        className="ml-auto whitespace-nowrap border border-green-300 text-green-700 bg-white px-3 py-1 rounded text-sm font-medium hover:bg-green-100"
                      >
                        Use as price/head
                      </button>
                    )}
                  </div>
                  {calculatedPrice.breakdown && calculatedPrice.breakdown.length > 0 && (
                    <div className="flex flex-wrap gap-2 text-xs">
                      {calculatedPrice.breakdown.map((item, i) => (
                        <span
                          key={i}
                          className={`px-2 py-0.5 rounded ${
                            item.type === "addition"
                              ? "bg-amber-50 text-amber-700 border border-amber-200"
                              : "bg-blue-50 text-blue-700 border border-blue-200"
                          }`}
                        >
                          {item.amount >= 0 ? "+" : ""}{currencySymbol}{item.amount} {item.dish}
                        </span>
                      ))}
                    </div>
                  )}
                </div>
              ) : (
                <>
                  <button
                    type="button"
                    onClick={handleCalculateRate}
                    disabled={priceLoading || disabled}
                    className="border border-blue-300 text-blue-700 bg-white px-4 py-1.5 rounded text-sm font-medium hover:bg-blue-50 disabled:opacity-50"
                  >
                    {priceLoading ? (
                      <span className="inline-flex items-center gap-2">
                        <svg className="animate-spin h-4 w-4" viewBox="0 0 24 24">
                          <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none" />
                          <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                        </svg>
                        Calculating...
                      </span>
                    ) : (
                      "Calculate Rate"
                    )}
                  </button>
                  <span className="text-xs text-gray-500">
                    {isTemplate && dishesModified
                      ? "Menu modified — click to recalculate"
                      : "Click to compute price from engine"}
                  </span>
                </>
              )}
            </div>
          ) : null}
        </>
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
