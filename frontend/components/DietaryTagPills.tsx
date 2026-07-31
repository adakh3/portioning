"use client";

import { DietaryTag } from "@/lib/api";
import { cn } from "@/lib/utils";

/** A dish's dietary/allergen labels as compact pills.
 *
 * Two visual registers, because they mean opposite things: a dietary tag is a
 * reassurance (GF, VG — green), an allergen is a warning (contains peanuts —
 * amber). Renders nothing at all when a dish has no tags, so untagged dishes
 * look exactly as they did before tags existed.
 */
/** The tags spelled out for a screen reader: "gluten-free, dairy-free, contains
 * fish". The pills themselves are an abbreviated *visual* shorthand — "GF DF FSH"
 * read aloud is gibberish — so they're aria-hidden and the owning control carries
 * this string instead. Empty for an untagged dish. */
export function dietaryTagsDescription(tags?: DietaryTag[]): string {
  if (!tags || tags.length === 0) return "";
  const dietary = tags.filter((t) => t.kind !== "allergen").map((t) => t.label.toLowerCase());
  const allergens = tags.filter((t) => t.kind === "allergen").map((t) => t.label.toLowerCase());
  const parts: string[] = [];
  if (dietary.length) parts.push(dietary.join(", "));
  if (allergens.length) parts.push(`contains ${allergens.join(", ")}`);
  return parts.join("; ");
}

export default function DietaryTagPills({
  tags,
  className,
}: {
  tags?: DietaryTag[];
  className?: string;
}) {
  if (!tags || tags.length === 0) return null;

  return (
    <span aria-hidden="true" className={cn("inline-flex flex-wrap items-center gap-1 align-middle", className)}>
      {tags.map((tag) => (
        <span
          key={tag.id}
          title={tag.kind === "allergen" ? `Contains ${tag.label.toLowerCase()}` : tag.label}
          className={cn(
            "inline-block rounded-xl px-[10px] py-[3px] text-[10px] font-semibold uppercase tracking-wide",
            tag.kind === "allergen"
              ? "bg-warning/15 text-warning"
              : "bg-success/15 text-success",
          )}
        >
          {tag.short_label || tag.label}
        </span>
      ))}
    </span>
  );
}
