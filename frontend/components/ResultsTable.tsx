"use client";

import { useState } from "react";
import { CalculationResult, PortionResult } from "@/lib/api";

interface Props {
  result: CalculationResult;
  overrides?: Map<number, number>;
  onPortionEdit?: (dishId: number, newGrams: number) => void;
  onResetDish?: (dishId: number) => void;
  onResetAll?: () => void;
}

interface CategoryGroup {
  category: string;
  portions: PortionResult[];
  subtotal: number;
}

function groupByCategory(
  portions: PortionResult[],
  overrides?: Map<number, number>
): CategoryGroup[] {
  const groups: CategoryGroup[] = [];
  const seen = new Map<string, CategoryGroup>();

  for (const p of portions) {
    let group = seen.get(p.category);
    if (!group) {
      group = {
        category: p.category,
        portions: [],
        subtotal: 0,
      };
      seen.set(p.category, group);
      groups.push(group);
    }
    group.portions.push(p);
    const grams = overrides?.get(p.dish_id) ?? p.grams_per_person;
    group.subtotal += grams;
  }

  for (const g of groups) {
    g.subtotal = Math.round(g.subtotal * 10) / 10;
  }

  return groups;
}

function EditableCell({
  value,
  isEdited,
  onEdit,
  onReset,
}: {
  value: number;
  isEdited: boolean;
  onEdit: (v: number) => void;
  onReset: () => void;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(String(value));

  const commit = () => {
    const num = parseFloat(draft);
    if (!isNaN(num) && num >= 0) {
      onEdit(Math.round(num * 10) / 10);
    }
    setEditing(false);
  };

  if (editing) {
    return (
      <input
        type="number"
        min="0"
        step="1"
        className="w-20 text-right border border-blue-400 rounded px-1 py-0.5 text-sm focus:outline-none focus:ring-1 focus:ring-blue-500"
        value={draft}
        autoFocus
        onChange={(e) => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === "Enter") commit();
          if (e.key === "Escape") setEditing(false);
        }}
      />
    );
  }

  return (
    <span className="inline-flex items-center gap-1">
      <button
        onClick={() => {
          setDraft(String(value));
          setEditing(true);
        }}
        className={`cursor-pointer hover:bg-blue-50 px-1 py-0.5 rounded text-right tabular-nums ${
          isEdited
            ? "bg-amber-50 text-amber-900 font-medium border border-amber-300"
            : ""
        }`}
        title="Click to edit"
      >
        {value}
      </button>
      {isEdited && (
        <button
          onClick={onReset}
          className="text-xs text-gray-400 hover:text-gray-600"
          title="Reset to engine value"
        >
          ↺
        </button>
      )}
    </span>
  );
}

export default function ResultsTable({
  result,
  overrides,
  onPortionEdit,
  onResetDish,
  onResetAll,
}: Props) {
  const { portions, totals } = result;
  const groups = groupByCategory(portions, overrides);
  const hasOverrides = overrides && overrides.size > 0;

  const totalFood = groups.reduce((sum, g) => sum + g.subtotal, 0);
  const totalFoodRounded = Math.round(totalFood * 10) / 10;

  return (
    <div className="bg-white border border-gray-200 rounded-lg overflow-hidden">
      {hasOverrides && onResetAll && (
        <div className="bg-amber-50 border-b border-amber-200 px-4 py-2 flex items-center justify-between">
          <span className="text-sm text-amber-800">
            You have edited {overrides.size} portion{overrides.size !== 1 ? "s" : ""} — totals reflect your changes
          </span>
          <button
            onClick={onResetAll}
            className="text-xs text-amber-700 hover:text-amber-900 font-medium underline"
          >
            Reset All
          </button>
        </div>
      )}
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="bg-gray-50 border-b border-gray-200">
            <tr>
              <th className="text-left px-4 py-3 font-medium text-gray-700">Dish</th>
              <th className="text-right px-4 py-3 font-medium text-gray-700">Per Person (g)</th>
            </tr>
          </thead>
          {groups.map((group) => (
            <tbody key={group.category}>
              {/* Category header */}
              <tr className="bg-gray-100 border-t border-gray-300">
                <td
                  colSpan={2}
                  className="px-4 py-2 font-semibold text-gray-800 text-xs uppercase tracking-wide"
                >
                  {group.category}
                </td>
              </tr>
              {/* Dish rows */}
              {group.portions.map((p) => {
                const effectiveGrams = overrides?.get(p.dish_id) ?? p.grams_per_person;
                const isEdited = overrides?.has(p.dish_id) ?? false;

                return (
                  <tr key={p.dish_id} className="hover:bg-gray-50 border-b border-gray-100">
                    <td className="px-4 py-2.5 pl-8 text-gray-900">{p.dish_name}</td>
                    <td className="px-4 py-2.5 text-right text-gray-900">
                      {onPortionEdit && onResetDish ? (
                        <EditableCell
                          value={effectiveGrams}
                          isEdited={isEdited}
                          onEdit={(v) => onPortionEdit(p.dish_id, v)}
                          onReset={() => onResetDish(p.dish_id)}
                        />
                      ) : (
                        effectiveGrams
                      )}
                    </td>
                  </tr>
                );
              })}
              {/* Subtotal row */}
              <tr className="bg-gray-50 border-b border-gray-200">
                <td className="px-4 py-2.5 pl-8 text-gray-800 font-semibold text-sm">
                  {group.category} Subtotal
                </td>
                <td className="px-4 py-2.5 text-right text-gray-800 font-semibold text-sm">
                  {group.subtotal}
                </td>
              </tr>
            </tbody>
          ))}
          <tfoot className="bg-gray-50 border-t-2 border-gray-300">
            <tr className="font-semibold">
              <td className="px-4 py-3 text-gray-900">Food per Person</td>
              <td className="px-4 py-3 text-right text-gray-900">
                {hasOverrides ? totalFoodRounded : totals.food_per_person_grams}g
              </td>
            </tr>
          </tfoot>
        </table>
      </div>
    </div>
  );
}
