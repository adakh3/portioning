"use client";

import { useEffect, useState } from "react";
import type { Dish, DishCategory } from "@/lib/api";
import DietaryTagPills, { dietaryTagsDescription } from "@/components/DietaryTagPills";

/** The dish library, opened inline inside the course it will add to (REL-451 AC8b).
 * Scoping it to a course is what removes the old second step — you pick a dish and
 * it lands where you asked, instead of picking then assigning.
 *
 * Three ways out, all of them obvious: Esc, the Cancel link, or the trigger that
 * opened it (which reads "Done" while open — the caller owns that label).
 * Creating a brand-new dish from in here is deliberately out of scope. */
export default function DishPickerInline({
  dishes,
  categories,
  onMenuDishIds,
  onAdd,
  onClose,
  courseName,
}: {
  dishes: Dish[];
  categories: DishCategory[];
  /** Dishes already on the booking — shown greyed as "on menu", never re-added. */
  onMenuDishIds: Set<number>;
  onAdd: (dishId: number) => void;
  onClose: () => void;
  /** Names the course in the accessible label, so screen readers get the scope. */
  courseName: string;
}) {
  const [search, setSearch] = useState("");
  const [categoryId, setCategoryId] = useState<number | null>(null);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const term = search.trim().toLowerCase();
  const groups = [...categories]
    .sort((a, b) => a.display_order - b.display_order)
    .map((cat) => ({
      ...cat,
      dishes: dishes.filter(
        (d) => d.category === cat.id && (!term || d.name.toLowerCase().includes(term)),
      ),
    }))
    .filter((g) => g.dishes.length > 0 && (categoryId === null || g.id === categoryId));

  return (
    <div
      data-testid="dish-picker"
      role="group"
      aria-label={`Add a dish to ${courseName}`}
      className="my-2 rounded-lg border border-border bg-background"
    >
      <div className="flex items-center gap-2 border-b border-border px-3 py-2">
        <input
          type="text"
          autoFocus
          aria-label="Search your dishes"
          placeholder="Search your dishes…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="flex-1 bg-transparent text-sm placeholder:text-muted-foreground focus:outline-none"
        />
        <button
          type="button"
          onClick={onClose}
          className="text-sm text-muted-foreground hover:text-foreground"
        >
          Cancel
        </button>
        <kbd className="text-xs text-muted-foreground/70">esc</kbd>
      </div>

      <div className="flex flex-wrap gap-1.5 border-b border-border px-3 py-2">
        {[{ id: null, display_name: "All" }, ...categories]
          .filter((c) => c.id === null || dishes.some((d) => d.category === c.id))
          .map((cat) => {
            const active = categoryId === (cat.id as number | null);
            return (
              <button
                type="button"
                key={String(cat.id)}
                onClick={() => setCategoryId(cat.id as number | null)}
                className={`rounded-full border px-3 py-1 text-xs transition-colors ${
                  active
                    ? "border-foreground bg-foreground text-background"
                    : "border-border bg-background text-foreground hover:bg-accent"
                }`}
              >
                {cat.display_name}
              </button>
            );
          })}
      </div>

      <div className="max-h-64 overflow-y-auto py-1">
        {groups.length === 0 ? (
          <p className="px-3 py-3 text-sm text-muted-foreground">No dishes match.</p>
        ) : (
          groups.map((group) => (
            <div key={group.id}>
              <p className="px-3 pb-1 pt-2 text-xs uppercase tracking-wide text-muted-foreground">
                {group.display_name} <span className="ml-1">{group.dishes.length}</span>
              </p>
              {group.dishes.map((dish) => {
                const onMenu = onMenuDishIds.has(dish.id);
                return (
                  <button
                    type="button"
                    key={dish.id}
                    disabled={onMenu}
                    aria-label={[
                      dish.name,
                      dietaryTagsDescription(dish.dietary_tags),
                      onMenu ? "already on menu" : `add to ${courseName}`,
                    ].filter(Boolean).join(" — ")}
                    onClick={() => onAdd(dish.id)}
                    className={`flex w-full items-center gap-2 px-3 py-1.5 text-left text-sm ${
                      onMenu
                        ? "cursor-default text-muted-foreground/60"
                        : "text-foreground hover:bg-accent"
                    }`}
                  >
                    <span>{dish.name}</span>
                    <DietaryTagPills tags={dish.dietary_tags} />
                    <span className="ml-auto text-xs">
                      {onMenu ? (
                        <span className="text-muted-foreground">on menu</span>
                      ) : (
                        <span aria-hidden="true" className="text-primary">+</span>
                      )}
                    </span>
                  </button>
                );
              })}
            </div>
          ))
        )}
      </div>
    </div>
  );
}
