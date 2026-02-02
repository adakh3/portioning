"use client";

import { Dish, DishCategory } from "@/lib/api";

interface Props {
  selectedDishIds: Set<number>;
  dishes: Dish[];
  categories: DishCategory[];
  userPortions: Map<number, number>;
  onPortionChange: (dishId: number, grams: number) => void;
}

interface CategoryGroup {
  category: DishCategory;
  dishes: Dish[];
}

export default function UserPortionInput({
  selectedDishIds,
  dishes,
  categories,
  userPortions,
  onPortionChange,
}: Props) {
  const selectedDishes = dishes.filter((d) => selectedDishIds.has(d.id));

  const grouped: CategoryGroup[] = categories
    .sort((a, b) => a.display_order - b.display_order)
    .map((cat) => ({
      category: cat,
      dishes: selectedDishes.filter((d) => d.category === cat.id),
    }))
    .filter((g) => g.dishes.length > 0);

  if (selectedDishes.length === 0) {
    return (
      <div className="bg-white border border-gray-200 rounded-lg p-4 text-gray-500 text-sm">
        Select dishes above to enter your portions.
      </div>
    );
  }

  return (
    <div className="bg-white border border-gray-200 rounded-lg p-4">
      <h3 className="text-sm font-semibold text-gray-700 mb-3">
        Your Portions (grams per person)
      </h3>
      <div className="space-y-4">
        {grouped.map(({ category, dishes: catDishes }) => (
          <div key={category.id}>
            <h4 className="text-xs font-medium text-gray-500 uppercase tracking-wide mb-2">
              {category.display_name}
            </h4>
            <div className="space-y-2">
              {catDishes.map((dish) => {
                const isQty = category.unit === "qty";
                return (
                  <div key={dish.id} className="flex items-center gap-3">
                    <label className="text-sm text-gray-700 w-48 truncate" title={dish.name}>
                      {dish.name}
                    </label>
                    <input
                      type="number"
                      min={0}
                      step={isQty ? 1 : 5}
                      value={userPortions.get(dish.id) ?? ""}
                      onChange={(e) => {
                        const val = parseFloat(e.target.value);
                        onPortionChange(dish.id, isNaN(val) ? 0 : val);
                      }}
                      placeholder="0"
                      className="border border-gray-300 rounded px-2 py-1 text-sm w-24 text-right"
                    />
                    <span className="text-xs text-gray-400">
                      {isQty ? "qty/person" : "g/person"}
                    </span>
                  </div>
                );
              })}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
