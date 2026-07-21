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
