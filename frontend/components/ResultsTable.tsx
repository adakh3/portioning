"use client";

import { useState } from "react";
import { CalculationResult, PortionResult } from "@/lib/api";
import { cn } from "@/lib/utils";

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
        className="w-20 text-right border border-ring rounded-md px-1 py-0.5 text-sm focus:outline-none focus:ring-1 focus:ring-ring"
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
        className={cn(
          "cursor-pointer hover:bg-accent px-1 py-0.5 rounded text-right tabular-nums",
          isEdited && "bg-warning/10 text-warning font-medium border border-warning/30"
        )}
        title="Click to edit"
      >
        {value}
      </button>
      {isEdited && (
        <button
          onClick={onReset}
          className="text-xs text-muted-foreground hover:text-foreground"
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
    <div className="bg-card border border-border rounded-lg overflow-hidden">
      {hasOverrides && onResetAll && (
        <div className="bg-warning/10 border-b border-warning/20 px-4 py-2 flex items-center justify-between">
          <span className="text-sm text-warning">
            You have edited {overrides.size} portion{overrides.size !== 1 ? "s" : ""} — totals reflect your changes
          </span>
          <button
            onClick={onResetAll}
            className="text-xs text-warning/80 hover:text-warning font-medium underline"
          >
            Reset All
          </button>
        </div>
      )}
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="bg-muted border-b border-border">
            <tr>
              <th className="text-left px-4 py-3 font-medium text-foreground">Dish</th>
              <th className="text-right px-4 py-3 font-medium text-foreground">Per Person (g)</th>
            </tr>
          </thead>
          {groups.map((group) => (
            <tbody key={group.category}>
              <tr className="bg-muted border-t border-border">
                <td
                  colSpan={2}
                  className="px-4 py-2 font-semibold text-foreground text-xs uppercase tracking-wide"
                >
                  {group.category}
                </td>
              </tr>
              {group.portions.map((p) => {
                const effectiveGrams = overrides?.get(p.dish_id) ?? p.grams_per_person;
                const isEdited = overrides?.has(p.dish_id) ?? false;

                return (
                  <tr key={p.dish_id} className="hover:bg-muted/50 border-b border-border">
                    <td className="px-4 py-2.5 pl-8 text-foreground">{p.dish_name}</td>
                    <td className="px-4 py-2.5 text-right text-foreground">
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
              <tr className="bg-muted border-b border-border">
                <td className="px-4 py-2.5 pl-8 text-foreground font-semibold text-sm">
                  {group.category} Subtotal
                </td>
                <td className="px-4 py-2.5 text-right text-foreground font-semibold text-sm">
                  {group.subtotal}
                </td>
              </tr>
            </tbody>
          ))}
          <tfoot className="bg-muted border-t-2 border-border">
            <tr className="font-semibold">
              <td className="px-4 py-3 text-foreground">Food per Person</td>
              <td className="px-4 py-3 text-right text-foreground">
                {hasOverrides ? totalFoodRounded : totals.food_per_person_grams}g
              </td>
            </tr>
          </tfoot>
        </table>
      </div>
    </div>
  );
}
