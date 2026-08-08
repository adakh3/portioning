// The one place that reads a `PricingPreview` and lays it out for the totals card.
//
// Quotes and events both show the same breakdown, so they both come through here
// — a second reader of this shape is a second chance to disagree about which
// field is the add-ons line, which is how the two pages came to derive it by
// subtraction on one screen and by summation on the other.
//
// Nothing here computes money. Every figure is passed along exactly as the engine
// spelled it (a decimal STRING); the only work done is choosing labels.
import type { PricingPreview } from "@/lib/api";
import type { TotalsFoodRow, TotalsMealRow } from "@/components/BookingTotalsCard";
import { formatCurrency } from "@/lib/utils";

export interface PreviewCardProps {
  foodTotal: string;
  foodRows: TotalsFoodRow[] | null;
  meals: TotalsMealRow[];
  addOnsTotal: string;
  subtotal: string;
  serviceCharge: string;
  taxAmount: string;
  gratuity: string;
  total: string;
}

/** A booking as the API returns it, so far as the totals card cares. */
export interface StoredBookingTotals {
  pricing_snapshot?: PricingPreview | null;
  food_total: string;
  subtotal: string;
  service_charge?: string | null;
  tax_amount: string;
  gratuity?: string | null;
  total: string;
}

/** Totals-card props for a booking that is NOT being edited — what was saved.
 *
 * The stored snapshot is the engine's own answer for this booking at the moment
 * it was saved, so a read-only screen shows the breakdown the save produced
 * rather than a fresh one that might not match the stored total beside it.
 *
 * Returns `null` when the booking has NO snapshot — every row saved before
 * REL-464, which are never backfilled (a snapshot records what a booking IS, not
 * what it should be). Null rather than a best-effort card on purpose: the flat
 * columns cannot express the meal rows or the per-segment itemisation, and a card
 * built from them silently drops both while printing a per-head food label beside
 * a meal-inclusive amount — two lines that contradict each other. The caller
 * renders those rows the old way instead; see `legacyCardProps` on the quote page.
 */
export function storedCardProps(booking: StoredBookingTotals, currencySymbol: string): PreviewCardProps | null {
  return booking.pricing_snapshot ? previewCardProps(booking.pricing_snapshot, currencySymbol) : null;
}

/** Totals-card props straight off a pricing preview. */
export function previewCardProps(preview: PricingPreview, currencySymbol: string): PreviewCardProps {
  return {
    foodTotal: preview.food.menu_food,
    // `null` means "not worth itemizing" (one shared rate, or a single segment) —
    // the card then shows the single food line instead. Preserved, not coerced to
    // an empty array, because `[]` would silently hide the food line entirely.
    foodRows: preview.food.food_rows,
    meals: preview.food.meal_rows.map((m) => ({
      label: `${m.label} (${formatCurrency(m.rate, currencySymbol)}/head × ${m.count})`,
      total: m.amount,
    })),
    addOnsTotal: preview.lines.add_ons_subtotal,
    subtotal: preview.totals.subtotal,
    serviceCharge: preview.totals.service_charge,
    taxAmount: preview.totals.tax_amount,
    gratuity: preview.totals.gratuity,
    total: preview.totals.total,
  };
}
