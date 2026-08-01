import { type ClassValue, clsx } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

/**
 * Format a number or numeric string as currency with thousand separators.
 * e.g. formatCurrency(1234.5, "$") → "$1,234.50"
 *
 * `currencySymbol` is required — there is no pound-sign default, so no caller
 * can silently render the wrong currency. In components, prefer
 * `useOrgLocale().formatMoney`.
 */
export function formatCurrency(
  amount: string | number,
  currencySymbol: string,
  decimals: number = 2,
): string {
  const num = typeof amount === "string" ? parseFloat(amount) : amount;
  if (isNaN(num)) return `${currencySymbol}0.${"0".repeat(decimals)}`;
  return `${currencySymbol}${num.toLocaleString(undefined, {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  })}`;
}

/**
 * A rate for display: "20", "8.5", "7.25" — never rounded to a whole number.
 *
 * US sales tax is routinely fractional (CA 7.25%, many states x.5%), so
 * rounding the label to an integer states a rate the customer is not being
 * charged: an 8.5% quote read "9%" on screen and "8%" on its PDF while the
 * money was correct in both. Keeps up to 2dp and strips trailing zeros so a
 * whole rate still shows as "20", not "20.00".
 */
export function formatPercent(value: string | number): string {
  const num = typeof value === "string" ? parseFloat(value) : value;
  if (isNaN(num)) return "0";
  return String(Number(num.toFixed(2)));
}
