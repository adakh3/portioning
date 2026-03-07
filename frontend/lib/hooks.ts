import useSWR, { mutate } from "swr";
import {
  api,
  Account,
  AuthUser,
  Venue,
  Lead,
  LeadFilters,
  Quote,
  EventData,
  Dish,
  DishCategory,
  MenuTemplate,
  SiteSettingsData,
  ProductLine,
  ChoiceOption,
  StaffMember,
  LaborRole,
  EquipmentItem,
  Invoice,
  ActivityLogEntry,
  DashboardStats,
  AllocationRule,
  StaffReportEntry,
  Reminder,
  ReminderCounts,
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

export function useProductLines() {
  return useSWR<ProductLine[]>("product-lines", () => api.getProductLines(), {
    dedupingInterval: 300000,
    revalidateOnFocus: false,
  });
}

export function useEventTypes() {
  return useSWR<ChoiceOption[]>("event-types", () => api.getEventTypes(), {
    dedupingInterval: 300000,
    revalidateOnFocus: false,
  });
}

export function useServiceStyles() {
  return useSWR<ChoiceOption[]>("service-styles", () => api.getServiceStyles(), {
    dedupingInterval: 300000,
    revalidateOnFocus: false,
  });
}

export function useSources() {
  return useSWR<ChoiceOption[]>("sources", () => api.getSources(), {
    dedupingInterval: 300000,
    revalidateOnFocus: false,
  });
}

export function useLeadStatuses() {
  return useSWR<ChoiceOption[]>("lead-statuses", () => api.getLeadStatuses(), {
    dedupingInterval: 300000,
    revalidateOnFocus: false,
  });
}

export function useLostReasons() {
  return useSWR<ChoiceOption[]>("lost-reasons", () => api.getLostReasons(), {
    dedupingInterval: 300000,
    revalidateOnFocus: false,
  });
}

export function useUsers() {
  return useSWR<AuthUser[]>("users", () => api.getUsers(), {
    dedupingInterval: 60000,
  });
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

export function useLeads(filters?: LeadFilters) {
  const qs = filters
    ? Object.entries(filters)
        .filter(([, v]) => v)
        .map(([k, v]) => `${k}=${v}`)
        .sort()
        .join("&")
    : "";
  const key = qs ? `leads?${qs}` : "leads";
  return useSWR<Lead[]>(key, () => api.getLeads(filters));
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

export function useLeadActivity(id: number | null) {
  return useSWR<ActivityLogEntry[]>(
    id ? `lead-activity-${id}` : null,
    () => api.getLeadActivity(id!)
  );
}

export function useDashboardStats(period: string | null) {
  return useSWR<DashboardStats>(
    period ? `dashboard-stats-${period}` : null,
    () => api.getDashboardStats(period!),
    { dedupingInterval: 30000 }
  );
}

export function useAllocationRules() {
  return useSWR<AllocationRule[]>("allocation-rules", () => api.getAllocationRules(), {
    dedupingInterval: 60000,
  });
}

export function useStaffReport(params?: { date_from?: string; date_to?: string }) {
  const key = params
    ? `staff-report-${params.date_from || ""}-${params.date_to || ""}`
    : "staff-report";
  return useSWR<StaffReportEntry[]>(key, () => api.getStaffReport(params), {
    dedupingInterval: 30000,
  });
}

export function useReminders(params?: { status?: string; due_before?: string; due_after?: string }) {
  const key = `reminders-${params?.status || "all"}-${params?.due_before || ""}-${params?.due_after || ""}`;
  return useSWR<Reminder[]>(key, () => api.getReminders(params), {
    dedupingInterval: 15000,
  });
}

export function useLeadReminders(leadId: number | null) {
  return useSWR<Reminder[]>(
    leadId ? `lead-reminders-${leadId}` : null,
    () => api.getLeadReminders(leadId!),
    { dedupingInterval: 15000 }
  );
}

export function useReminderCounts() {
  return useSWR<ReminderCounts>("reminder-counts", () => api.getReminderCounts(), {
    dedupingInterval: 30000,
  });
}

export function useInvoices(params?: { event?: number; status?: string }) {
  const key = params?.status
    ? `invoices-status-${params.status}`
    : params?.event
      ? `invoices-event-${params.event}`
      : "invoices";
  return useSWR<Invoice[]>(key, () => api.getInvoices(params));
}
