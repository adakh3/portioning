// Shared vocabulary for the add-on catalogue: how a catalogue product becomes a
// booking line, and how that line reads on screen. Kept out of the components so
// the editor and the picker can't disagree about what a line is called or whether
// it is already on the booking (REL-454).
import type { AddOnProduct, AddOnVariant } from "@/lib/api";
import type { LineItemInput } from "@/lib/bookingPayload";

/** Category options offered on a custom (ad-hoc) line. */
export const ADDON_CATEGORIES: [string, string][] = [
  ["food", "Food"], ["beverage", "Beverage"], ["rental", "Rental"],
  ["labor", "Labour"], ["fee", "Fee"], ["discount", "Discount"],
];

/** Unit options offered on a custom line. */
export const ADDON_UNITS: [string, string][] = [
  ["each", "Each"], ["per_guest", "Per guest"], ["per_hour", "Per hour"], ["flat", "Flat"],
];

/** Section headings in the picker and, lower-cased, nothing else. */
export const CATEGORY_LABELS: Record<string, string> = {
  food: "Food", beverage: "Beverages", rental: "Arrangements & rentals",
  labor: "Labour", fee: "Fees", discount: "Discounts",
};

/** The order a caterer thinks in — anything else the org invents falls in after. */
export const CATEGORY_ORDER = ["beverage", "rental", "food", "labor", "fee", "discount"];

/** How a unit reads inside a line's price subtitle: "$150.00 each". */
export function unitLabel(unit: string): string {
  const found = ADDON_UNITS.find(([v]) => v === unit);
  return found ? found[1].toLowerCase() : unit;
}

/** The line description for a catalogue variant. Un-named variants (a product with
 * a single unnamed price) read as just the product.
 *
 * The separator is an em dash because that is what every line saved before REL-454
 * already uses, and the description is stored — a middle dot here would put two
 * spellings of the same thing on one booking, and on its PDF (owner's call). */
export function variantDescription(product: AddOnProduct, variant: AddOnVariant): string {
  return variant.name ? `${product.name} — ${variant.name}` : product.name;
}

/** A booking line for a catalogue variant, priced from the catalogue. */
export function variantLine(product: AddOnProduct, variant: AddOnVariant): LineItemInput {
  return {
    variant: variant.id,
    category: product.category,
    description: variantDescription(product, variant),
    quantity: "1",
    unit: product.default_unit,
    unit_price: variant.unit_price,
  };
}

/** A booking line for a product that has no variants — its own base price. */
export function productLine(product: AddOnProduct): LineItemInput {
  return {
    variant: null,
    category: product.category,
    description: product.name,
    quantity: "1",
    unit: product.default_unit,
    unit_price: product.unit_price ?? "",
  };
}

/** Is this variant already a line on the booking? Matched by variant id, so a
 * renamed or repriced line still counts. */
export function hasVariant(items: LineItemInput[], variantId: number): boolean {
  return items.some((it) => it.variant === variantId);
}

/** Is this variant-less product already a line? There is no id to match on, so this
 * is the same fragile name match the editor has always used: a *custom* line that
 * happens to be named after a catalogue product reads as "on quote". Accepted —
 * it is exactly today's behaviour, and the alternative is a schema change. */
export function hasProduct(items: LineItemInput[], product: AddOnProduct): boolean {
  return items.some((it) => !it.variant && it.description === product.name);
}
