"use client";

import { useEffect, useState, useCallback, useMemo } from "react";
import {
  api,
  MenuTemplate,
  MenuTemplateDetail,
  Dish,
  SiteSettingsData,
} from "@/lib/api";
import MenuBuilder from "@/components/MenuBuilder";

const MENU_TYPE_LABELS: Record<string, string> = {
  barat: "Barat / Walima",
  mehndi: "Mehndi / Mayon",
  custom: "Custom",
};

export default function PricingPage() {
  const [templates, setTemplates] = useState<MenuTemplate[]>([]);
  const [dishes, setDishes] = useState<Dish[]>([]);
  const [settings, setSettings] = useState<SiteSettingsData | null>(null);
  const [loading, setLoading] = useState(true);

  // Expanded template row
  const [expandedId, setExpandedId] = useState<number | null>(null);
  const [expandedDetail, setExpandedDetail] =
    useState<MenuTemplateDetail | null>(null);
  const [expandLoading, setExpandLoading] = useState(false);

  // Custom pricer state
  const [customDishIds, setCustomDishIds] = useState<number[]>([]);
  const [customTemplate, setCustomTemplate] = useState<number | null>(null);
  const [customGuestCount, setCustomGuestCount] = useState<string>("");

  useEffect(() => {
    Promise.all([api.getMenus(), api.getDishes(), api.getSiteSettings()])
      .then(([t, d, s]) => {
        setTemplates(t);
        setDishes(d);
        setSettings(s);
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  const currencySymbol = settings?.currency_symbol || "Rs.";

  // Group templates by menu_type, only show barat/mehndi in the tier section
  const grouped = useMemo(() => {
    const groups: Record<string, MenuTemplate[]> = {};
    for (const t of templates) {
      const type = t.menu_type || "custom";
      if (!groups[type]) groups[type] = [];
      groups[type].push(t);
    }
    return groups;
  }, [templates]);

  // Collect all unique tier thresholds across all templates in a group
  const getTierThresholds = (menus: MenuTemplate[]): number[] => {
    const set = new Set<number>();
    for (const m of menus) {
      for (const t of m.price_tiers || []) {
        set.add(t.min_guests);
      }
    }
    return Array.from(set).sort((a, b) => a - b);
  };

  const handleExpandTemplate = async (id: number) => {
    if (expandedId === id) {
      setExpandedId(null);
      setExpandedDetail(null);
      return;
    }
    setExpandedId(id);
    setExpandLoading(true);
    try {
      const detail = await api.getMenu(id);
      setExpandedDetail(detail);
    } catch {
      setExpandedDetail(null);
    } finally {
      setExpandLoading(false);
    }
  };

  const handleCustomChange = useCallback(
    (data: { dish_ids: number[]; based_on_template: number | null }) => {
      setCustomDishIds(data.dish_ids);
      setCustomTemplate(data.based_on_template);
    },
    []
  );

  if (loading) {
    return <p className="text-gray-500">Loading...</p>;
  }

  // Display order: barat first, then mehndi
  const sectionOrder = ["barat", "mehndi"];

  return (
    <div className="space-y-10">
      <div>
        <h1 className="text-2xl font-bold text-gray-900 mb-1">Menu Pricing</h1>
        <p className="text-sm text-gray-500">
          Fixed menu prices by guest count tier, or build a custom menu to
          estimate pricing.
        </p>
      </div>

      {/* Section A — Menu Templates grouped by type */}
      {sectionOrder.map((menuType) => {
        const menus = grouped[menuType];
        if (!menus || menus.length === 0) return null;
        const thresholds = getTierThresholds(menus);
        const colCount = 2 + thresholds.length; // name + dishes + tier cols

        return (
          <section key={menuType}>
            <h2 className="text-lg font-semibold text-gray-800 mb-3">
              {MENU_TYPE_LABELS[menuType] || menuType}
            </h2>
            <div className="bg-white border border-gray-200 rounded-lg overflow-hidden">
              <table className="w-full text-sm">
                <thead>
                  <tr className="bg-gray-50 border-b border-gray-200 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    <th className="px-4 py-3">Menu</th>
                    <th className="px-4 py-3 text-center">Dishes</th>
                    {thresholds.map((th) => (
                      <th key={th} className="px-4 py-3 text-right">
                        {th}+ pax
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {menus.map((t) => {
                    const tierMap = new Map(
                      (t.price_tiers || []).map((pt) => [
                        pt.min_guests,
                        pt.price_per_head,
                      ])
                    );
                    return (
                      <TierTemplateRow
                        key={t.id}
                        template={t}
                        thresholds={thresholds}
                        tierMap={tierMap}
                        currencySymbol={currencySymbol}
                        colCount={colCount}
                        isExpanded={expandedId === t.id}
                        detail={expandedId === t.id ? expandedDetail : null}
                        detailLoading={expandedId === t.id && expandLoading}
                        onToggle={() => handleExpandTemplate(t.id)}
                        priceRoundingStep={settings?.price_rounding_step ? Number(settings.price_rounding_step) : 50}
                      />
                    );
                  })}
                </tbody>
              </table>
            </div>
          </section>
        );
      })}

      {/* Custom menus (no tiers) — show with old-style suggested price if any exist */}
      {grouped["custom"] && grouped["custom"].length > 0 && (
        <section>
          <h2 className="text-lg font-semibold text-gray-800 mb-3">
            Custom Menus
          </h2>
          <div className="bg-white border border-gray-200 rounded-lg overflow-hidden">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-gray-50 border-b border-gray-200 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  <th className="px-4 py-3">Menu</th>
                  <th className="px-4 py-3 text-center">Dishes</th>
                  <th className="px-4 py-3 text-right">Est. Price/Head</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {grouped["custom"].map((t) => (
                  <tr
                    key={t.id}
                    onClick={() => handleExpandTemplate(t.id)}
                    className="cursor-pointer hover:bg-gray-50 transition-colors"
                  >
                    <td className="px-4 py-3 font-medium text-gray-900">
                      <span className="mr-1.5 text-gray-400 text-xs">
                        {expandedId === t.id ? "▼" : "▶"}
                      </span>
                      {t.name}
                    </td>
                    <td className="px-4 py-3 text-center text-gray-600">
                      {t.dish_count}
                    </td>
                    <td className="px-4 py-3 text-right font-medium">
                      {t.suggested_price_per_head !== null ? (
                        <span className="text-gray-900">
                          {currencySymbol}
                          {t.suggested_price_per_head.toFixed(2)}
                        </span>
                      ) : (
                        <span className="text-gray-400">—</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}

      {/* Section B — Custom Menu Pricer */}
      <section>
        <h2 className="text-lg font-semibold text-gray-800 mb-3">
          Custom Menu Pricer
        </h2>
        <p className="text-sm text-gray-500 mb-4">
          Pick dishes and enter a guest count, then click &quot;Calculate Rate&quot; to see a price estimate.
        </p>

        <div className="bg-white border border-gray-200 rounded-lg p-5 space-y-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Guest Count</label>
            <input
              type="number"
              min="1"
              value={customGuestCount}
              onChange={(e) => setCustomGuestCount(e.target.value)}
              placeholder="e.g. 150"
              className="border border-gray-300 rounded px-3 py-2 text-sm w-40"
            />
          </div>
          <MenuBuilder
            selectedDishIds={customDishIds}
            basedOnTemplate={customTemplate}
            guestCount={customGuestCount ? Number(customGuestCount) : undefined}
            onChange={handleCustomChange}
            currencySymbol={currencySymbol}
            priceRoundingStep={settings?.price_rounding_step ? Number(settings.price_rounding_step) : 50}
          />
        </div>

      </section>
    </div>
  );
}

/* ── Tier Template Row with expandable dish list ── */

function roundToStep(value: number, step: number): number {
  if (step <= 1) return value;
  return Math.round(value / step) * step;
}

function TierTemplateRow({
  template,
  thresholds,
  tierMap,
  currencySymbol,
  colCount,
  isExpanded,
  detail,
  detailLoading,
  onToggle,
  priceRoundingStep = 1,
}: {
  template: MenuTemplate;
  thresholds: number[];
  tierMap: Map<number, string>;
  currencySymbol: string;
  colCount: number;
  isExpanded: boolean;
  detail: MenuTemplateDetail | null;
  detailLoading: boolean;
  onToggle: () => void;
  priceRoundingStep?: number;
}) {
  return (
    <>
      <tr
        onClick={onToggle}
        className="cursor-pointer hover:bg-gray-50 transition-colors"
      >
        <td className="px-4 py-3 font-medium text-gray-900">
          <span className="mr-1.5 text-gray-400 text-xs">
            {isExpanded ? "▼" : "▶"}
          </span>
          {template.name}
        </td>
        <td className="px-4 py-3 text-center text-gray-600">
          {template.dish_count || "—"}
        </td>
        {thresholds.map((th) => {
          const price = tierMap.get(th);
          return (
            <td key={th} className="px-4 py-3 text-right font-medium">
              {price ? (
                <span className="text-gray-900">
                  {currencySymbol}
                  {roundToStep(parseFloat(price), priceRoundingStep).toLocaleString()}
                </span>
              ) : (
                <span className="text-gray-400">—</span>
              )}
            </td>
          );
        })}
      </tr>
      {isExpanded && (
        <tr>
          <td colSpan={colCount} className="px-4 py-3 bg-gray-50">
            {detailLoading ? (
              <p className="text-sm text-gray-500">Loading dishes...</p>
            ) : detail && detail.portions.length > 0 ? (
              <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-x-6 gap-y-1 text-sm">
                {detail.portions.map((p) => (
                  <div key={p.dish_id} className="flex items-baseline gap-1.5">
                    <span className="text-gray-900">{p.dish_name}</span>
                    <span className="text-xs text-gray-400">
                      {p.category_name}
                    </span>
                  </div>
                ))}
              </div>
            ) : detail ? (
              <p className="text-sm text-gray-400">
                No dishes assigned to this menu yet.
              </p>
            ) : (
              <p className="text-sm text-red-500">
                Failed to load template details.
              </p>
            )}
          </td>
        </tr>
      )}
    </>
  );
}
