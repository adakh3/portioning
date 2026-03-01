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
    return <p className="text-sm text-muted-foreground">Loading menu options...</p>;
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
          className="border border-input rounded-md px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-ring disabled:bg-muted"
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
          className="border border-input text-foreground bg-background px-3 py-2 rounded text-sm font-medium hover:bg-accent disabled:opacity-50"
        >
          {showSelector ? "Hide Dish Picker" : "Pick Individual Dishes"}
        </button>
        {selected.size > 0 && !disabled && (
          <button
            type="button"
            onClick={handleClearMenu}
            className="text-destructive text-sm hover:text-destructive/80"
          >
            Clear All
          </button>
        )}
      </div>

      {/* Template indicator */}
      {templateName && (
        <p className="text-xs text-muted-foreground">
          Based on template: <span className="font-medium">{templateName}</span>
        </p>
      )}

      {/* Current Menu (dish names only) */}
      {selectedDishes.length > 0 ? (
        <div>
          <h4 className="text-sm font-medium text-foreground mb-2">
            Menu ({selectedDishes.length} dishes)
          </h4>
          <div className="flex flex-wrap gap-2">
            {selectedDishes.map((dish) => (
              <span
                key={dish.id}
                className="inline-flex items-center gap-1.5 bg-primary/10 text-primary border border-primary/20 px-2.5 py-1 rounded-full text-sm"
              >
                {dish.name}
                {dish.is_vegetarian && (
                  <span className="text-success text-xs">V</span>
                )}
                {!disabled && (
                  <button
                    type="button"
                    onClick={() => toggleDish(dish.id)}
                    className="text-primary/60 hover:text-primary ml-0.5"
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
        <p className="text-sm text-muted-foreground">
          No dishes selected. Load a template or pick dishes individually.
        </p>
      )}

      {/* Pricing Summary Bar */}
      {hasDishes && (
        <>
          {!hasGuestCount ? (
            /* No guest count */
            <div className="flex items-center gap-3 bg-muted border border-border rounded-lg px-4 py-2.5">
              <span className="text-sm text-muted-foreground">
                Enter guest count to see pricing
              </span>
            </div>
          ) : showTierPrice && tierPrice ? (
            /* Template, unmodified, has tier */
            <div className="flex items-center gap-3 flex-wrap bg-success/10 border border-success/20 rounded-lg px-4 py-2.5">
              <span className="text-sm font-medium text-success">
                {currencySymbol}{applyExtra(tierPrice.price).toLocaleString()}/head
              </span>
              <span className="text-xs text-success/80">
                ({tierPrice.label} tier)
              </span>
              <label className="inline-flex items-center gap-1.5 text-xs text-muted-foreground">
                Extra food
                <input
                  type="number"
                  min={0}
                  max={100}
                  step={5}
                  value={extraFoodPercent || ""}
                  onChange={(e) => setExtraFoodPercent(Number(e.target.value) || 0)}
                  placeholder="0"
                  className="w-14 border border-input rounded px-1.5 py-0.5 text-xs text-center"
                />
                %
              </label>
              {onUseSuggestedPrice && (
                <button
                  type="button"
                  onClick={() => onUseSuggestedPrice(applyExtra(tierPrice.price))}
                  className="ml-auto whitespace-nowrap border border-success/30 text-success bg-background px-3 py-1 rounded text-sm font-medium hover:bg-success/10"
                >
                  Use as price/head
                </button>
              )}
            </div>
          ) : showCalculateButton ? (
            /* Need to calculate */
            <div className="flex items-center gap-3 flex-wrap bg-muted border border-border rounded-lg px-4 py-2.5">
              {calculatedPrice ? (
                <div className="flex flex-col gap-1.5 w-full">
                  <div className="flex items-center gap-3 flex-wrap">
                    <span className="text-sm font-medium text-success">
                      {currencySymbol}{applyExtra(calculatedPrice.price).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}/head
                    </span>
                    {calculatedPrice.hasUnpriced && (
                      <span className="inline-flex items-center bg-warning/15 text-warning text-xs font-medium px-2 py-0.5 rounded">
                        Some dishes unpriced
                      </span>
                    )}
                    {calculatedPrice.source === "template_adjusted" && (
                      <span className="text-xs text-success/80">
                        ({calculatedPrice.tierLabel} tier {calculatedPrice.totalAdjustment !== undefined && calculatedPrice.totalAdjustment >= 0 ? "+" : ""}{currencySymbol}{calculatedPrice.totalAdjustment?.toFixed(2)})
                      </span>
                    )}
                    {calculatedPrice.source === "computed" && (
                      <span className="text-xs text-success/80">(computed from engine)</span>
                    )}
                    <label className="inline-flex items-center gap-1.5 text-xs text-muted-foreground">
                      Extra food
                      <input
                        type="number"
                        min={0}
                        max={100}
                        step={5}
                        value={extraFoodPercent || ""}
                        onChange={(e) => setExtraFoodPercent(Number(e.target.value) || 0)}
                        placeholder="0"
                        className="w-14 border border-input rounded px-1.5 py-0.5 text-xs text-center"
                      />
                      %
                    </label>
                    {onUseSuggestedPrice && (
                      <button
                        type="button"
                        onClick={() => onUseSuggestedPrice(applyExtra(calculatedPrice.price))}
                        className="ml-auto whitespace-nowrap border border-success/30 text-success bg-background px-3 py-1 rounded text-sm font-medium hover:bg-success/10"
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
                              ? "bg-warning/10 text-warning border border-warning/20"
                              : "bg-info/10 text-info border border-info/20"
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
                    className="border border-primary/30 text-primary bg-background px-4 py-1.5 rounded text-sm font-medium hover:bg-primary/5 disabled:opacity-50"
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
                  <span className="text-xs text-muted-foreground">
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
        <div className="border border-border rounded-lg p-4 bg-muted">
          <div className="flex items-center justify-between mb-3">
            <h4 className="text-sm font-medium text-foreground">
              Select Dishes ({selected.size} selected)
            </h4>
            <input
              type="text"
              placeholder="Search dishes..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="border border-input rounded px-3 py-1.5 text-sm w-48"
            />
          </div>
          <div className="space-y-3 max-h-72 overflow-y-auto">
            {grouped.map((group) => {
              const selectedInCat = group.dishes.filter((d) =>
                selected.has(d.id)
              ).length;
              return (
                <div key={group.id}>
                  <h5 className="text-xs font-medium text-muted-foreground mb-1">
                    {group.display_name}
                    <span className="text-muted-foreground ml-1">
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
                              ? "bg-primary/10 text-primary border border-primary/30"
                              : "bg-background text-foreground border border-border hover:bg-accent"
                          }`}
                        >
                          {dish.name}
                          {dish.is_vegetarian && (
                            <span className="ml-1 text-success text-xs">V</span>
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
            className="bg-primary text-primary-foreground px-4 py-2 rounded text-sm font-medium hover:bg-primary/90 disabled:opacity-50"
          >
            {saving ? "Saving..." : "Save Menu"}
          </button>
        </div>
      )}
    </div>
  );
}
