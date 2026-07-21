"use client";

/**
 * Single source of truth for org locale (currency / tax / date / time).
 *
 * Before this, 10+ files each re-invented their own `£`/VAT/`DD/MM/YYYY`
 * fallback, so a US org leaked UK formatting on whichever page was missed.
 * Everything now reads `useOrgLocale()`; a lint-style guard test forbids raw
 * `£`/"GBP"/"VAT" literals elsewhere.
 *
 * Loading is **neutral**: while settings load, money/date render as an em-dash,
 * never a hardcoded symbol — so the first paint of a US org is never "£".
 */
import { createContext, useContext, ReactNode } from "react";

import type { SiteSettingsData } from "./api";
import { useSiteSettings } from "./hooks";
import { formatCurrency } from "./utils";
import { formatDate, formatDateTime, formatTime } from "./dateFormat";

const NEUTRAL = "—";

export interface OrgLocale {
  /** True until settings have loaded — formatters return neutral placeholders. */
  loading: boolean;
  symbol: string;
  code: string;
  taxLabel: string;
  dateFormat: string;
  timeFormat: string;
  formatMoney: (amount: string | number | null | undefined, decimals?: number) => string;
  formatDate: (value: string | null | undefined) => string;
  formatDateTime: (value: string | null | undefined) => string;
  formatTime: (value: string | null | undefined) => string;
}

function computeLocale(data: SiteSettingsData | undefined, loading: boolean): OrgLocale {
  const symbol = data?.currency_symbol ?? "";
  // Neutral (US-generic) fallbacks — only used if a value is genuinely absent;
  // the real value always comes from settings.
  const dateFormat = data?.date_format || "MM/DD/YYYY";
  const timeFormat = data?.time_format || "24h";
  return {
    loading,
    symbol,
    code: data?.currency_code ?? "",
    taxLabel: data?.tax_label ?? "",
    dateFormat,
    timeFormat,
    formatMoney: (amount, decimals = 2) =>
      loading || amount === null || amount === undefined || amount === ""
        ? NEUTRAL
        : formatCurrency(amount, symbol, decimals),
    formatDate: (value) => (loading || !value ? NEUTRAL : formatDate(value, dateFormat)),
    formatDateTime: (value) =>
      loading || !value ? NEUTRAL : formatDateTime(value, dateFormat, timeFormat),
    formatTime: (value) => (loading || !value ? "" : formatTime(value, timeFormat)),
  };
}

const OrgLocaleContext = createContext<OrgLocale | null>(null);

/** Wrap the app once (root layout) so settings resolve to a single shared locale. */
export function OrgLocaleProvider({ children }: { children: ReactNode }) {
  const { data, isLoading } = useSiteSettings();
  const locale = computeLocale(data, isLoading && !data);
  return <OrgLocaleContext.Provider value={locale}>{children}</OrgLocaleContext.Provider>;
}

/**
 * Read the org locale. Uses the provider's shared value when mounted; otherwise
 * computes from `useSiteSettings()` directly, so components render correctly in
 * isolation (unit tests) without wrapping every one in the provider.
 */
export function useOrgLocale(): OrgLocale {
  const ctx = useContext(OrgLocaleContext);
  const { data, isLoading } = useSiteSettings();
  return ctx ?? computeLocale(data, isLoading && !data);
}
