import useSWR, { mutate } from "swr";
import {
  api,
  Account,
  Venue,
  Lead,
  Quote,
  EventData,
  Dish,
  DishCategory,
  MenuTemplate,
  SiteSettingsData,
  BudgetRangeOption,
  StaffMember,
  LaborRole,
  EquipmentItem,
  Invoice,
} from "./api";

// ── Revalidation helper ──

export function revalidate(...keys: string[]) {
  keys.forEach((k) => mutate(k));
}

// ── Shared lookups (long dedupe, used by many pages) ──

export function useAccounts() {
  return useSWR<Account[]>("accounts", () => api.getAccounts(), {
    dedupingInterval: 60000,
  });
}

export function useVenues() {
  return useSWR<Venue[]>("venues", () => api.getVenues(), {
    dedupingInterval: 60000,
  });
}

export function useSiteSettings() {
  return useSWR<SiteSettingsData>("settings", () => api.getSiteSettings(), {
    dedupingInterval: 300000,
    revalidateOnFocus: false,
  });
}

export function useBudgetRanges() {
  return useSWR<BudgetRangeOption[]>(
    "budget-ranges",
    () => api.getBudgetRanges(),
    { dedupingInterval: 300000, revalidateOnFocus: false }
  );
}

export function useDishes() {
  return useSWR<Dish[]>("dishes", () => api.getDishes(), {
    dedupingInterval: 60000,
  });
}

export function useCategories() {
  return useSWR<DishCategory[]>("categories", () => api.getCategories(), {
    dedupingInterval: 60000,
  });
}

export function useMenus() {
  return useSWR<MenuTemplate[]>("menus", () => api.getMenus(), {
    dedupingInterval: 60000,
  });
}

// ── Parameterized resources ──

export function useEvent(id: number | null) {
  return useSWR<EventData>(
    id ? `event-${id}` : null,
    () => api.getEvent(id!)
  );
}

export function useEvents(params?: {
  status?: string;
  date_from?: string;
  date_to?: string;
}) {
  const key = params?.status
    ? `events-status-${params.status}`
    : params?.date_from
      ? `events-from-${params.date_from}`
      : "events";
  return useSWR<EventData[]>(key, () => api.getEvents(params));
}

export function useAccount(id: number | null) {
  return useSWR<Account>(
    id ? `account-${id}` : null,
    () => api.getAccount(id!)
  );
}

export function useLead(id: number | null) {
  return useSWR<Lead>(id ? `lead-${id}` : null, () => api.getLead(id!));
}

export function useLeads(status?: string) {
  const key = status ? `leads-${status}` : "leads";
  return useSWR<Lead[]>(key, () => api.getLeads(status));
}

export function useQuote(id: number | null) {
  return useSWR<Quote>(id ? `quote-${id}` : null, () => api.getQuote(id!));
}

export function useQuotes(status?: string) {
  const key = status ? `quotes-${status}` : "quotes";
  return useSWR<Quote[]>(key, () =>
    api.getQuotes(status === "all" ? undefined : status)
  );
}

export function useStaff() {
  return useSWR<StaffMember[]>("staff", () => api.getStaff(), {
    dedupingInterval: 60000,
  });
}

export function useLaborRoles() {
  return useSWR<LaborRole[]>("labor-roles", () => api.getLaborRoles(), {
    dedupingInterval: 60000,
  });
}

export function useEquipment() {
  return useSWR<EquipmentItem[]>("equipment", () => api.getEquipment(), {
    dedupingInterval: 60000,
  });
}

export function useInvoice(id: number | null) {
  return useSWR<Invoice>(
    id ? `invoice-${id}` : null,
    () => api.getInvoice(id!)
  );
}

export function useInvoices(params?: { event?: number; status?: string }) {
  const key = params?.status
    ? `invoices-status-${params.status}`
    : params?.event
      ? `invoices-event-${params.event}`
      : "invoices";
  return useSWR<Invoice[]>(key, () => api.getInvoices(params));
}
