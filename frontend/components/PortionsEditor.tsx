"use client";

import { Dish, DishCategory } from "@/lib/api";

interface Props {
  dishes: Dish[];
  categories: DishCategory[];
  selectedDishIds: Set<number>;
  portions: Map<number, number>;
  engineRecs: Map<number, number> | null;
  onPortionChange: (dishId: number, grams: number) => void;
}

interface CategoryGroup {
  category: DishCategory;
  dishes: Dish[];
  subtotal: number;
  engineSubtotal: number | null;
}

function deltaColor(absPct: number) {
  if (absPct <= 10) return "text-green-600";
  return "text-amber-600";
}

function groupByCategory(
  dishes: Dish[],
  categories: DishCategory[],
  selectedDishIds: Set<number>,
  portions: Map<number, number>,
  engineRecs: Map<number, number> | null
): CategoryGroup[] {
  const selectedDishes = dishes.filter((d) => selectedDishIds.has(d.id));
  const groups: CategoryGroup[] = [];

  for (const cat of [...categories].sort((a, b) => a.display_order - b.display_order)) {
    const catDishes = selectedDishes.filter((d) => d.category === cat.id);
    if (catDishes.length === 0) continue;

    let subtotal = 0;
    let engineSubtotal: number | null = engineRecs ? 0 : null;

    for (const d of catDishes) {
      subtotal += portions.get(d.id) ?? 0;
      if (engineRecs && engineSubtotal !== null) {
        engineSubtotal += engineRecs.get(d.id) ?? 0;
      }
    }

    groups.push({
      category: cat,
      dishes: catDishes,
      subtotal: Math.round(subtotal * 10) / 10,
      engineSubtotal: engineSubtotal !== null ? Math.round(engineSubtotal * 10) / 10 : null,
    });
  }

  return groups;
}

export default function PortionsEditor({
  dishes,
  categories,
  selectedDishIds,
  portions,
  engineRecs,
  onPortionChange,
}: Props) {
  const groups = groupByCategory(dishes, categories, selectedDishIds, portions, engineRecs);

  if (selectedDishIds.size === 0) {
    return (
      <div className="bg-white border border-gray-200 rounded-lg p-4 text-gray-500 text-sm">
        Select dishes above to configure portions.
      </div>
    );
  }

  const totalPortion = groups.reduce((sum, g) => sum + g.subtotal, 0);
  const totalEngine = engineRecs
    ? groups.reduce((sum, g) => sum + (g.engineSubtotal ?? 0), 0)
    : null;

  return (
    <div className="bg-white border border-gray-200 rounded-lg overflow-hidden">
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="bg-gray-50 border-b border-gray-200">
            <tr>
              <th className="text-left px-4 py-3 font-medium text-gray-700">Dish</th>
              <th className="text-right px-4 py-3 font-medium text-gray-700 w-32">Your Portion</th>
              {engineRecs && (
                <>
                  <th className="text-right px-4 py-3 font-medium text-gray-700 w-28">Engine Rec</th>
                  <th className="text-right px-4 py-3 font-medium text-gray-700 w-28">Delta</th>
                </>
              )}
            </tr>
          </thead>
          {groups.map((group) => {
            const isQty = group.category.unit === "qty";
            const suffix = isQty ? "pcs" : "g";

            return (
              <tbody key={group.category.id}>
                {/* Category header */}
                <tr className="bg-gray-100 border-t border-gray-300">
                  <td
                    colSpan={engineRecs ? 4 : 2}
                    className="px-4 py-2 font-semibold text-gray-800 text-xs uppercase tracking-wide"
                  >
                    {group.category.display_name}
                  </td>
                </tr>
                {/* Dish rows */}
                {group.dishes.map((dish) => {
                  const value = portions.get(dish.id) ?? 0;
                  const engineVal = engineRecs?.get(dish.id);
                  const deltaGrams = engineVal !== undefined ? value - engineVal : null;
                  const deltaPct =
                    engineVal !== undefined && engineVal !== 0
                      ? ((value - engineVal) / engineVal) * 100
                      : null;

                  return (
                    <tr key={dish.id} className="hover:bg-gray-50 border-b border-gray-100">
                      <td className="px-4 py-2.5 pl-8 text-gray-900">{dish.name}</td>
                      <td className="px-4 py-2.5 text-right">
                        <input
                          type="number"
                          min={0}
                          step={isQty ? 1 : 5}
                          value={value || ""}
                          onChange={(e) => {
                            const val = parseFloat(e.target.value);
                            onPortionChange(dish.id, isNaN(val) ? 0 : val);
                          }}
                          placeholder="0"
                          className="w-24 text-right border border-gray-300 rounded px-2 py-1 text-sm focus:outline-none focus:ring-1 focus:ring-blue-500 focus:border-blue-500"
                        />
                        <span className="text-xs text-gray-400 ml-1">{suffix}</span>
                      </td>
                      {engineRecs && (
                        <>
                          <td className="px-4 py-2.5 text-right font-mono text-gray-500">
                            {engineVal !== undefined ? `${engineVal}${suffix}` : "—"}
                          </td>
                          <td className="px-4 py-2.5 text-right font-mono">
                            {deltaGrams !== null && deltaPct !== null ? (
                              <span className={deltaColor(Math.abs(deltaPct))}>
                                {deltaGrams > 0 ? "+" : ""}
                                {Math.round(deltaGrams)}{suffix}
                                <span className="text-xs ml-1">
                                  ({deltaPct > 0 ? "+" : ""}
                                  {Math.round(deltaPct)}%)
                                </span>
                              </span>
                            ) : deltaGrams !== null ? (
                              <span className="text-gray-400">
                                {deltaGrams > 0 ? "+" : ""}
                                {Math.round(deltaGrams)}{suffix}
                              </span>
                            ) : (
                              "—"
                            )}
                          </td>
                        </>
                      )}
                    </tr>
                  );
                })}
                {/* Subtotal row */}
                <tr className="bg-gray-50 border-b border-gray-200">
                  <td className="px-4 py-2.5 pl-8 text-gray-800 font-semibold text-sm">
                    {group.category.display_name} Subtotal
                  </td>
                  <td className="px-4 py-2.5 text-right text-gray-800 font-semibold text-sm">
                    {group.subtotal}{suffix}
                  </td>
                  {engineRecs && (
                    <>
                      <td className="px-4 py-2.5 text-right text-gray-500 font-semibold text-sm font-mono">
                        {group.engineSubtotal !== null ? `${group.engineSubtotal}${suffix}` : "—"}
                      </td>
                      <td className="px-4 py-2.5" />
                    </>
                  )}
                </tr>
              </tbody>
            );
          })}
          <tfoot className="bg-gray-50 border-t-2 border-gray-300">
            <tr className="font-semibold">
              <td className="px-4 py-3 text-gray-900">Food per Person</td>
              <td className="px-4 py-3 text-right text-gray-900">
                {Math.round(totalPortion * 10) / 10}g
              </td>
              {engineRecs && (
                <>
                  <td className="px-4 py-3 text-right text-gray-500 font-mono">
                    {totalEngine !== null ? `${Math.round(totalEngine * 10) / 10}g` : "—"}
                  </td>
                  <td className="px-4 py-3 text-right font-mono">
                    {totalEngine !== null && totalEngine !== 0 ? (
                      <span
                        className={deltaColor(
                          Math.abs(((totalPortion - totalEngine) / totalEngine) * 100)
                        )}
                      >
                        {totalPortion - totalEngine > 0 ? "+" : ""}
                        {Math.round((totalPortion - totalEngine) * 10) / 10}g
                      </span>
                    ) : null}
                  </td>
                </>
              )}
            </tr>
          </tfoot>
        </table>
      </div>
    </div>
  );
}
