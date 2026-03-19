import useSWR, { mutate } from "swr";
import { useCallback, useRef, useState } from "react";
import {
  api,
  Account,
  AuthUser,
  Venue,
  Lead,
  LeadFilters,
  PaginatedResponse,
  KanbanResponse,
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
  WhatsAppMessage,
} from "./api";

// ── Revalidation helper ──

export function revalidate(...keys: string[]) {
  keys.forEach((k) => mutate(k));
}

// ── Date format ──

export function useDateFormat(): string {
  const { data } = useSiteSettings();
  return data?.date_format || "DD/MM/YYYY";
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

export function useMealTypes() {
  return useSWR<ChoiceOption[]>("meal-types", () => api.getMealTypes(), {
    dedupingInterval: 300000,
    revalidateOnFocus: false,
  });
}

export function useArrangementTypes() {
  return useSWR<ChoiceOption[]>("arrangement-types", () => api.getArrangementTypes(), {
    dedupingInterval: 300000,
    revalidateOnFocus: false,
  });
}

export function useBeverageTypes() {
  return useSWR<ChoiceOption[]>("beverage-types", () => api.getBeverageTypes(), {
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
  page_size?: number;
}) {
  const key = params?.status
    ? `events-status-${params.status}`
    : params?.date_from
      ? `events-from-${params.date_from}${params.page_size ? `-ps${params.page_size}` : ""}`
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
        .filter(([, v]) => v != null && v !== "")
        .map(([k, v]) => `${k}=${v}`)
        .sort()
        .join("&")
    : "";
  const key = qs ? `leads?${qs}` : "leads";
  return useSWR<Lead[]>(key, () => api.getLeads(filters));
}

/** Paginated leads — returns { data, count, hasMore } for a specific page. */
export function useLeadsPaginated(filters?: LeadFilters, paused?: boolean) {
  const qs = filters
    ? Object.entries(filters)
        .filter(([, v]) => v != null && v !== "")
        .map(([k, v]) => `${k}=${v}`)
        .sort()
        .join("&")
    : "";
  const key = paused ? null : (qs ? `leads-paginated?${qs}` : "leads-paginated");
  return useSWR<PaginatedResponse<Lead>>(key, () => api.getLeadsPaginated(filters));
}

/** Fetch leads for a single Kanban column with lazy "Load more". */
export function useLeadsByStatus(
  status: string,
  filters?: LeadFilters,
  pageSize: number = 20,
  paused?: boolean,
) {
  const qs = filters
    ? Object.entries(filters)
        .filter(([, v]) => v != null && v !== "")
        .map(([k, v]) => `${k}=${v}`)
        .sort()
        .join("&")
    : "";
  const activeKey = `leads-col-${status}${qs ? `?${qs}` : ""}-ps${pageSize}`;
  const key = paused ? null : activeKey;

  // SWR fetches page 1
  const { data, error, isLoading, mutate: mutateSWR } = useSWR<PaginatedResponse<Lead>>(
    key,
    () => api.getLeadsPaginated({ ...filters, status, page_size: pageSize, page: 1 }),
  );

  // Extra pages accumulated locally
  const [extraLeads, setExtraLeads] = useState<Lead[]>([]);
  const [loadingMore, setLoadingMore] = useState(false);
  const pageRef = useRef(1);

  // Reset extras when SWR data changes (filters changed, revalidation, etc.)
  const prevKeyRef = useRef(key);
  if (prevKeyRef.current !== key) {
    prevKeyRef.current = key;
    setExtraLeads([]);
    pageRef.current = 1;
  }

  const allLeads = [...(data?.results || []), ...extraLeads];
  const count = data?.count ?? 0;
  const hasMore = allLeads.length < count;

  const loadMore = useCallback(async () => {
    if (loadingMore || !hasMore) return;
    setLoadingMore(true);
    try {
      const nextPage = pageRef.current + 1;
      const resp = await api.getLeadsPaginated({ ...filters, status, page_size: pageSize, page: nextPage });
      pageRef.current = nextPage;
      setExtraLeads((prev) => [...prev, ...resp.results]);
    } finally {
      setLoadingMore(false);
    }
  }, [loadingMore, hasMore, filters, status, pageSize]);

  const revalidateColumn = useCallback(() => {
    setExtraLeads([]);
    pageRef.current = 1;
    mutateSWR();
  }, [mutateSWR]);

  return { leads: allLeads, count, hasMore, loadMore, loadingMore, isLoading, error, revalidateColumn };
}

/** Single-endpoint Kanban data — returns all columns in one API call. */
export function useKanbanData(filters?: LeadFilters, paused?: boolean) {
  const qs = filters
    ? Object.entries(filters)
        .filter(([, v]) => v != null && v !== "")
        .map(([k, v]) => `${k}=${v}`)
        .sort()
        .join("&")
    : "";
  const key = paused ? null : (qs ? `leads-kanban?${qs}` : "leads-kanban");

  const { data, error, isLoading, mutate: mutateSWR } = useSWR<KanbanResponse>(
    key,
    () => api.getLeadsKanban(filters),
  );

  const revalidate = useCallback(() => {
    mutateSWR();
  }, [mutateSWR]);

  return { data, error, isLoading, revalidate, swrKey: key };
}

/** Fetch ALL leads (page_size=all) — used by Kanban view. */
export function useAllLeads(filters?: LeadFilters) {
  const qs = filters
    ? Object.entries(filters)
        .filter(([, v]) => v)
        .map(([k, v]) => `${k}=${v}`)
        .sort()
        .join("&")
    : "";
  const key = qs ? `all-leads?${qs}` : "all-leads";
  return useSWR<Lead[]>(key, () => api.getAllLeads(filters));
}

export function useQuote(id: number | null) {
  return useSWR<Quote>(id ? `quote-${id}` : null, () => api.getQuote(id!));
}

export function useQuotes(status?: string, pageSize?: number) {
  const key = status
    ? `quotes-${status}${pageSize ? `-ps${pageSize}` : ""}`
    : `quotes${pageSize ? `-ps${pageSize}` : ""}`;
  return useSWR<Quote[]>(key, () =>
    api.getQuotes(status === "all" ? undefined : status, pageSize)
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

export function useDashboardStats(period: string | null, dateFrom?: string, dateTo?: string) {
  const key = period
    ? period === "custom"
      ? `dashboard-stats-custom-${dateFrom || ""}-${dateTo || ""}`
      : `dashboard-stats-${period}`
    : null;
  return useSWR<DashboardStats>(
    key,
    () => api.getDashboardStats(period!, dateFrom, dateTo),
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

export function useLeadWhatsAppMessages(leadId: number | null) {
  return useSWR<WhatsAppMessage[]>(
    leadId ? `lead-whatsapp-${leadId}` : null,
    () => api.getLeadWhatsAppMessages(leadId!),
    { dedupingInterval: 15000 }
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
