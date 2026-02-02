"use client";

import { Dish, DishCategory } from "@/lib/api";
import { useState } from "react";

interface Props {
  dishes: Dish[];
  categories: DishCategory[];
  selectedIds: Set<number>;
  onToggle: (id: number) => void;
}

export default function DishSelector({ dishes, categories, selectedIds, onToggle }: Props) {
  const [search, setSearch] = useState("");

  const filtered = dishes.filter(
    (d) => d.name.toLowerCase().includes(search.toLowerCase())
  );

  const grouped = categories
    .sort((a, b) => a.display_order - b.display_order)
    .map((cat) => ({
      ...cat,
      dishes: filtered.filter((d) => d.category === cat.id),
    }))
    .filter((g) => g.dishes.length > 0);

  return (
    <div className="bg-white border border-gray-200 rounded-lg p-4">
      <div className="flex items-center justify-between mb-3">
        <h3 className="font-semibold text-gray-900">
          Dishes ({selectedIds.size} selected)
        </h3>
        <input
          type="text"
          placeholder="Search dishes..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="border border-gray-300 rounded px-3 py-1.5 text-sm w-48"
        />
      </div>
      <div className="space-y-4 max-h-96 overflow-y-auto">
        {grouped.map((group) => {
          const selectedInCat = group.dishes.filter((d) => selectedIds.has(d.id)).length;
          return (
            <div key={group.id}>
              <h4 className="text-sm font-medium text-gray-700 mb-1">
                {group.display_name}
                <span className="text-gray-400 ml-1">({selectedInCat}/{group.dishes.length})</span>
              </h4>
              <div className="grid grid-cols-2 md:grid-cols-3 gap-1">
                {group.dishes.map((dish) => {
                  const selected = selectedIds.has(dish.id);
                  return (
                    <button
                      key={dish.id}
                      onClick={() => onToggle(dish.id)}
                      className={`text-left text-sm px-3 py-2 rounded transition-colors ${
                        selected
                          ? "bg-blue-100 text-blue-800 border border-blue-300"
                          : "bg-gray-50 text-gray-700 border border-gray-200 hover:bg-gray-100"
                      }`}
                    >
                      <span>{dish.name}</span>
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
  );
}
