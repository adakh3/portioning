"use client";

import type { Dish, DishCategory } from "@/lib/api";
import DietaryTagPills, { dietaryTagsDescription } from "@/components/DietaryTagPills";
import InlinePicker from "@/components/InlinePicker";

/** The dish library, opened inline inside the course it will add to (REL-451 AC8b).
 * Scoping it to a course is what removes the old second step — you pick a dish and
 * it lands where you asked, instead of picking then assigning.
 *
 * The search box, tabs and grouped scroll body are `InlinePicker`, shared with the
 * add-on catalogue (REL-454); this file is only the dish half — which dishes match,
 * and what a dish row looks like. Creating a brand-new dish from in here is
 * deliberately out of scope. */
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
  // Tabs come from the whole library, not the search results: a tab that vanished
  // as you typed would move the thing you were reaching for.
  const tabs = categories
    .filter((c) => dishes.some((d) => d.category === c.id))
    .map((c) => ({ key: String(c.id), label: c.display_name }));

  return (
    <InlinePicker
      testId="dish-picker"
      ariaLabel={`Add a dish to ${courseName}`}
      searchLabel="Search your dishes"
      searchPlaceholder="Search your dishes…"
      emptyMessage="No dishes match."
      tabs={tabs}
      onClose={onClose}
    >
      {(term, tab) =>
        [...categories]
          .sort((a, b) => a.display_order - b.display_order)
          .map((cat) => ({
            cat,
            dishes: dishes.filter(
              (d) => d.category === cat.id && (!term || d.name.toLowerCase().includes(term)),
            ),
          }))
          .filter(({ cat, dishes: ds }) => ds.length > 0 && (tab === null || String(cat.id) === tab))
          .map(({ cat, dishes: ds }) => ({
            key: String(cat.id),
            label: cat.display_name,
            count: ds.length,
            rows: ds.map((dish) => {
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
            }),
          }))
      }
    </InlinePicker>
  );
}
