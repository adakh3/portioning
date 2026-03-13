const API_BASE = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000/api";

export interface AuthUser {
  id: number;
  email: string;
  first_name: string;
  last_name: string;
  role: string;
  organisation: { id: number; name: string } | null;
}

// ── CSRF token helper ──
function getCsrfToken(): string | null {
  if (typeof document === "undefined") return null;
  const match = document.cookie.match(/(?:^|;\s*)csrftoken=([^;]*)/);
  return match ? decodeURIComponent(match[1]) : null;
}

function buildHeaders(options?: RequestInit): Record<string, string> {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    ...(options?.headers as Record<string, string>),
  };
  const csrf = getCsrfToken();
  if (csrf) headers["X-CSRFToken"] = csrf;
  return headers;
}

// Refresh deduplication — only one refresh in-flight at a time
let refreshPromise: Promise<boolean> | null = null;

async function tryRefresh(): Promise<boolean> {
  if (refreshPromise) return refreshPromise;
  refreshPromise = fetch(`${API_BASE}/auth/refresh/`, {
    method: "POST",
    credentials: "include",
    headers: buildHeaders(),
  })
    .then((res) => res.ok)
    .finally(() => {
      refreshPromise = null;
    });
  return refreshPromise;
}

function sanitizeError(status: number, text: string): string {
  if (status >= 500) return `Server error (${status})`;
  try {
    const json = JSON.parse(text);
    if (json.detail) return json.detail;
  } catch { /* not JSON */ }
  return text.length > 200 ? text.slice(0, 200) + "…" : text;
}

async function fetchApi<T>(path: string, options?: RequestInit): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`, {
    credentials: "include",
    headers: buildHeaders(options),
    ...options,
  });
  if (res.status === 401 && !path.startsWith("/auth/")) {
    const refreshed = await tryRefresh();
    if (refreshed) {
      const retry = await fetch(`${API_BASE}${path}`, {
        credentials: "include",
        headers: buildHeaders(options),
        ...options,
      });
      if (!retry.ok) {
        const text = await retry.text();
        throw new Error(sanitizeError(retry.status, text));
      }
      return retry.json();
    }
    throw new Error("Unauthorized");
  }
  if (!res.ok) {
    const text = await res.text();
    throw new Error(sanitizeError(res.status, text));
  }
  return res.json();
}

// Types
export interface DishCategory {
  id: number;
  name: string;
  display_name: string;
  display_order: number;
  pool: "protein" | "accompaniment" | "dessert" | "service";
  unit: "kg" | "qty";
  addition_surcharge: string;
  removal_discount: string;
}

export interface Dish {
  id: number;
  name: string;
  category: number;
  category_name: string;
  protein_type: string;
  default_portion_grams: number;
  popularity: number;
  cost_per_gram: number;
  selling_price_per_gram: string | null;
  selling_price_override: boolean;
  margin_percent: number | null;
  is_vegetarian: boolean;
  notes: string;
}

export interface PriceTier {
  min_guests: number;
  price_per_head: string;
}

export interface MenuTemplate {
  id: number;
  name: string;
  description: string;
  menu_type: string;
  default_gents: number;
  default_ladies: number;
  dish_count: number;
  suggested_price_per_head: number | null;
  has_unpriced_dishes: boolean;
  price_tiers: PriceTier[];
  created_at: string;
}

export interface MenuDishPortion {
  dish_id: number;
  dish_name: string;
  category_name: string;
  portion_grams: number;
}

export interface MenuTemplateDetail extends MenuTemplate {
  portions: MenuDishPortion[];
  suggested_price_per_head: number | null;
  has_unpriced_dishes: boolean;
}

export interface GuestMix {
  gents: number;
  ladies: number;
}

export interface PortionResult {
  dish_id: number;
  dish_name: string;
  category: string;
  protein_type: string;
  pool?: string;
  unit?: string;
  grams_per_person: number;
  grams_per_gent: number;
  grams_per_lady: number;
  total_grams: number;
  cost_per_gent: number;
  total_cost: number;
}

export interface CalculationResult {
  portions: PortionResult[];
  totals: {
    food_per_gent_grams: number;
    food_per_lady_grams: number;
    food_per_person_grams: number;
    protein_per_person_grams: number;
    total_food_weight_grams: number;
    total_cost: number;
  };
  warnings: string[];
  adjustments_applied: string[];
  source?: string;
}

export interface EventDishComment {
  dish_id: number;
  dish_name?: string;
  comment: string;
  portion_grams?: number;
}

// Bookings types
export interface Account {
  id: number;
  name: string;
  account_type: string;
  billing_address_line1: string;
  billing_address_line2: string;
  billing_city: string;
  billing_postcode: string;
  billing_country: string;
  vat_number: string;
  payment_terms: string;
  notes: string;
  contacts: Contact[];
  created_at: string;
  updated_at: string;
}

export interface Contact {
  id: number;
  account: number;
  name: string;
  email: string;
  phone: string;
  role: string;
  is_primary: boolean;
  notes: string;
  created_at: string;
  updated_at: string;
}

export interface Venue {
  id: number;
  name: string;
  address_line1: string;
  address_line2: string;
  city: string;
  postcode: string;
  country: string;
  contact_name: string;
  contact_phone: string;
  contact_email: string;
  loading_notes: string;
  kitchen_access: boolean;
  power_water_notes: string;
  rules: string;
  notes: string;
  created_at: string;
  updated_at: string;
}

export interface LeadQuoteSummary {
  id: number;
  status: string;
  status_display: string;
  total: string;
  created_at: string;
}

export interface ProductLine {
  id: number;
  name: string;
  is_active: boolean;
}

export interface Lead {
  id: number;
  account: number | null;
  account_name: string | null;
  contact_name: string;
  contact_email: string;
  contact_phone: string;
  source: string;
  event_date: string | null;
  guest_estimate: number | null;
  budget: string | null;
  event_type: string;
  event_type_display: string;
  meal_type: string;
  service_style: string;
  notes: string;
  product: number | null;
  product_name: string | null;
  assigned_to: number | null;
  assigned_to_name: string | null;
  lead_date: string | null;
  status: string;
  status_display: string;
  won_quote: number | null;
  won_event: number | null;
  won_event_name: string | null;
  lost_reason_option: number | null;
  lost_reason_option_display: string | null;
  lost_notes: string;
  contacted_at: string | null;
  qualified_at: string | null;
  proposal_sent_at: string | null;
  won_at: string | null;
  lost_at: string | null;
  created_at: string;
  updated_at: string;
  quotes: LeadQuoteSummary[];
}

export interface QuoteLineItem {
  id: number;
  quote: number;
  category: string;
  description: string;
  quantity: string;
  unit: string;
  unit_price: string;
  is_taxable: boolean;
  line_total: string;
  sort_order: number;
  menu_item: number | null;
  equipment_item: number | null;
  labor_role: number | null;
  created_at: string;
}

export interface Quote {
  id: number;
  lead: number | null;
  lead_name: string | null;
  account: number;
  account_name: string;
  primary_contact: number | null;
  contact_name: string | null;
  contact_email: string | null;
  contact_phone: string | null;
  version: number;
  status: string;
  status_display: string;
  is_editable: boolean;
  event_date: string;
  venue: number | null;
  venue_name: string | null;
  venue_address: string;
  guest_count: number;
  price_per_head: string | null;
  food_total: string;
  event_type: string;
  meal_type: string;
  booking_date: string | null;
  service_style: string;
  valid_until: string | null;
  subtotal: string;
  tax_rate: string;
  tax_amount: string;
  total: string;
  dishes: number[];
  dish_names: string[];
  based_on_template: number | null;
  notes: string;
  internal_notes: string;
  sent_at: string | null;
  accepted_at: string | null;
  event: number | null;
  event_id: number | null;
  line_items: QuoteLineItem[];
  created_at: string;
  updated_at: string;
}

// Staff & Labor types
export interface LaborRole {
  id: number;
  name: string;
  default_hourly_rate: string;
  description: string;
  color: string;
  sort_order: number;
  is_active: boolean;
  created_at: string;
}

export interface AllocationRule {
  id: number;
  role: number;
  role_name: string;
  event_type: string;
  guests_per_staff: number;
  minimum_staff: number;
  is_active: boolean;
  created_at: string;
}

export interface StaffReportEntry {
  staff_member_id: number;
  staff_member_name: string;
  total_shifts: number;
  total_hours: string;
  total_cost: string;
  shifts_by_status: Record<string, number>;
}

export interface StaffMember {
  id: number;
  name: string;
  email: string;
  phone: string;
  roles: number[];
  role_names: string[];
  hourly_rate: string | null;
  certifications: string;
  emergency_contact: string;
  emergency_phone: string;
  is_active: boolean;
  notes: string;
  created_at: string;
  updated_at: string;
}

export interface Shift {
  id: number;
  event: number;
  staff_member: number | null;
  staff_member_name: string | null;
  role: number;
  role_name: string;
  start_time: string;
  end_time: string;
  break_minutes: number;
  hourly_rate: string;
  status: string;
  notes: string;
  duration_hours: string;
  shift_cost: string;
  created_at: string;
}

// Equipment types
export interface EquipmentItem {
  id: number;
  name: string;
  category: string;
  description: string;
  stock_quantity: number;
  rental_price: string;
  replacement_cost: string | null;
  notes: string;
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

export interface EquipmentReservation {
  id: number;
  event: number;
  equipment: number;
  equipment_name: string;
  quantity_out: number;
  quantity_returned: number | null;
  return_condition: string;
  notes: string;
  line_cost: string;
  created_at: string;
}

// Finance types
export interface Payment {
  id: number;
  invoice: number;
  amount: string;
  payment_date: string;
  method: string;
  reference: string;
  notes: string;
  created_at: string;
}

export interface Invoice {
  id: number;
  event: number;
  invoice_number: string;
  invoice_type: string;
  issue_date: string;
  due_date: string;
  subtotal: string;
  tax_rate: string;
  tax_amount: string;
  total: string;
  status: string;
  notes: string;
  sent_at: string | null;
  paid_at: string | null;
  payments: Payment[];
  amount_paid: string;
  balance_due: string;
  is_overdue: boolean;
  created_at: string;
  updated_at: string;
}

// Choice option type (DB-backed dropdowns)
export interface ChoiceOption {
  id: number;
  value: string;
  label: string;
  sort_order: number;
  is_active: boolean;
}

// Settings types
export interface SiteSettingsData {
  currency_symbol: string;
  currency_code: string;
  date_format: string;
  default_price_per_head: string;
  target_food_cost_percentage: string;
  price_rounding_step: string;
}

// Event type (updated with booking fields)
export interface EventData {
  id: number;
  name: string;
  date: string;
  gents: number;
  ladies: number;
  big_eaters: boolean;
  big_eaters_percentage: number;
  dishes: number[];
  based_on_template: number | null;
  notes: string;
  kitchen_instructions: string;
  banquet_instructions: string;
  setup_instructions: string;
  dish_comments?: EventDishComment[];
  constraint_override?: {
    max_total_food_per_person_grams?: number;
    min_portion_per_dish_grams?: number;
  };
  created_at: string;
  // Booking fields
  account: number | null;
  account_name: string | null;
  primary_contact: number | null;
  contact_name: string | null;
  venue: number | null;
  venue_name: string | null;
  venue_address: string;
  event_type: string;
  meal_type: string;
  service_style: string;
  booking_date: string | null;
  price_per_head: string | null;
  status: string;
  status_display: string;
  // Timeline
  setup_time: string | null;
  guest_arrival_time: string | null;
  meal_time: string | null;
  end_time: string | null;
  // Guest counts
  guaranteed_count: number | null;
  final_count: number | null;
  final_count_due: string | null;
  // Nested
  source_quote_id: number | null;
  arrangements: EventArrangement[];
  shifts: Shift[];
  equipment_reservations: EquipmentReservation[];
  invoices: Invoice[];
}

export interface EventArrangement {
  id?: number;
  arrangement_type: string;
  quantity: number;
  notes: string;
}

// Check Portions types
export interface UserPortion {
  dish_id: number;
  grams_per_person: number;
}

export interface CheckPortionsRequest {
  dish_ids: number[];
  guests: GuestMix;
  user_portions: UserPortion[];
  big_eaters?: boolean;
  big_eaters_percentage?: number;
  constraint_overrides?: Record<string, number>;
}

export interface Violation {
  type: string;
  severity: "error" | "warning";
  message: string;
  [key: string]: unknown;
}

export interface ComparisonRow {
  dish_id: number;
  dish_name: string;
  category: string;
  pool: string;
  unit: "kg" | "qty";
  user_grams: number;
  engine_grams: number;
  delta_grams: number;
  delta_percent: number;
}

export interface CheckResult {
  violations: Violation[];
  user_portions_expanded: PortionResult[];
  engine_portions: PortionResult[];
  comparison: ComparisonRow[];
  user_totals: {
    food_per_gent_grams: number;
    food_per_lady_grams: number;
    food_per_person_grams: number;
    total_food_weight_grams: number;
  };
  engine_totals: CalculationResult["totals"];
}

// Price check types
export interface PriceCheckBreakdownItem {
  dish: string;
  category: string;
  type: "addition" | "removal";
  amount: number;
}

export interface PriceCheckResult {
  tier_price: number;
  tier_label: string;
  breakdown: PriceCheckBreakdownItem[];
  total_adjustment: number;
  adjusted_price: number;
}

export interface PriceEstimateResult {
  price_per_head: number;
  has_unpriced: boolean;
}

// Activity log
export interface ActivityLogEntry {
  id: number;
  action: string;
  field_name: string;
  old_value: string;
  new_value: string;
  description: string;
  user_name: string | null;
  created_at: string;
}

// Reminders
export interface Reminder {
  id: number;
  lead: number;
  lead_name: string;
  user: number;
  user_name: string;
  due_at: string;
  note: string;
  status: string;
  snoozed_until: string | null;
  completed_at: string | null;
  created_by: number | null;
  created_by_name: string | null;
  created_at: string;
}

export interface ReminderCounts {
  overdue: number;
  due_today: number;
}

export interface AutoAssignResult {
  assigned: number;
  skipped_no_product: number;
  skipped_no_staff: number;
}

// Dashboard stats
export interface SalespersonPerformance {
  user_id: number | null;
  user_name: string;
  pipeline: Record<string, number>;
  pipeline_value: number;
  total_assigned: number;
  period_created: number;
  period_won: number;
  period_lost: number;
  overdue_reminders: number;
  stale_leads: number;
}

export interface DashboardStats {
  lead_summary: {
    new_leads: number;
    status_transitions: number;
    won: number;
    lost: number;
    total_active: number;
  };
  team_activity: {
    user_id: number;
    user_name: string;
    leads_created: number;
    transitions_made: number;
    won: number;
    lost: number;
  }[];
  salesperson_performance: SalespersonPerformance[];
  status_columns: { value: string; label: string }[];
  lost_reasons: { reason: string; count: number }[];
  status_distribution: { status: string; label: string; count: number }[];
  kpis: {
    conversion_rate: number;
    avg_days_to_convert: number | null;
    pipeline_value: string;
    pipeline_count: number;
  };
}

// Lead filter params
export interface LeadFilters {
  status?: string;
  assigned_to?: string;
  product?: string;
  event_type?: string;
  date_from?: string;
  date_to?: string;
  lead_date_from?: string;
  lead_date_to?: string;
  ordering?: string;
}

// API functions
export const api = {
  // Auth
  login: (email: string, password: string) =>
    fetchApi<AuthUser>("/auth/login/", {
      method: "POST",
      body: JSON.stringify({ email, password }),
    }),
  logout: async () => {
    await fetch(`${API_BASE}/auth/logout/`, { method: "POST", credentials: "include", headers: buildHeaders() });
  },
  getMe: () => fetchApi<AuthUser>("/auth/me/"),

  getDishes: () => fetchApi<Dish[]>("/dishes/"),
  getCategories: () => fetchApi<DishCategory[]>("/categories/"),
  getMenus: () => fetchApi<MenuTemplate[]>("/menus/"),
  getMenu: (id: number) => fetchApi<MenuTemplateDetail>(`/menus/${id}/`),
  getMenuPreview: (id: number) => fetchApi<CalculationResult>(`/menus/${id}/preview/`),
  menuPriceCheck: (templateId: number, data: { guest_count: number; dish_ids: number[] }) =>
    fetchApi<PriceCheckResult>(`/menus/${templateId}/price-check/`, {
      method: "POST",
      body: JSON.stringify(data),
    }),
  priceEstimate: (data: { dish_ids: number[]; guest_count: number }) =>
    fetchApi<PriceEstimateResult>("/price-estimate/", {
      method: "POST",
      body: JSON.stringify(data),
    }),
  calculate: (data: {
    dish_ids: number[];
    guests: GuestMix;
    big_eaters?: boolean;
    big_eaters_percentage?: number;
    constraint_overrides?: Record<string, number>;
  }) => fetchApi<CalculationResult>("/calculate/", {
    method: "POST",
    body: JSON.stringify(data),
  }),
  checkPortions: (data: CheckPortionsRequest) =>
    fetchApi<CheckResult>("/check-portions/", {
      method: "POST",
      body: JSON.stringify(data),
    }),
  getEvents: (params?: { status?: string; date_from?: string; date_to?: string }) => {
    const searchParams = new URLSearchParams();
    if (params?.status) searchParams.set("status", params.status);
    if (params?.date_from) searchParams.set("date_from", params.date_from);
    if (params?.date_to) searchParams.set("date_to", params.date_to);
    const qs = searchParams.toString();
    return fetchApi<EventData[]>(`/events/${qs ? `?${qs}` : ""}`);
  },
  createEvent: (data: Partial<EventData> & { dish_ids?: number[]; dish_comments?: EventDishComment[] }) =>
    fetchApi<EventData>("/events/", {
      method: "POST",
      body: JSON.stringify(data),
    }),
  getEvent: (id: number) => fetchApi<EventData>(`/events/${id}/`),
  updateEvent: (id: number, data: Partial<EventData> & { dish_ids?: number[]; dish_comments?: EventDishComment[] }) =>
    fetchApi<EventData>(`/events/${id}/`, {
      method: "PATCH",
      body: JSON.stringify(data),
    }),
  deleteEvent: (id: number) =>
    fetchApi<void>(`/events/${id}/`, { method: "DELETE" }),
  calculateEvent: (id: number) =>
    fetchApi<CalculationResult>(`/events/${id}/calculate/`, { method: "POST" }),
  exportPDF: async (data: {
    dish_ids: number[];
    guests: GuestMix;
    big_eaters?: boolean;
    big_eaters_percentage?: number;
    menu_name?: string;
    date?: string;
    constraint_overrides?: Record<string, number>;
  }): Promise<Blob> => {
    const res = await fetch(`${API_BASE}/export-pdf/`, {
      method: "POST",
      credentials: "include",
      headers: buildHeaders(),
      body: JSON.stringify(data),
    });
    if (!res.ok) {
      const text = await res.text();
      throw new Error(sanitizeError(res.status, text));
    }
    return res.blob();
  },

  // Bookings: Accounts
  getAccounts: () => fetchApi<Account[]>("/bookings/accounts/"),
  getAccount: (id: number) => fetchApi<Account>(`/bookings/accounts/${id}/`),
  createAccount: (data: Partial<Account>) =>
    fetchApi<Account>("/bookings/accounts/", { method: "POST", body: JSON.stringify(data) }),
  updateAccount: (id: number, data: Partial<Account>) =>
    fetchApi<Account>(`/bookings/accounts/${id}/`, { method: "PATCH", body: JSON.stringify(data) }),
  deleteAccount: (id: number) =>
    fetchApi<void>(`/bookings/accounts/${id}/`, { method: "DELETE" }),
  createContact: (accountId: number, data: Partial<Contact>) =>
    fetchApi<Contact>(`/bookings/accounts/${accountId}/contacts/`, { method: "POST", body: JSON.stringify(data) }),
  updateContact: (accountId: number, contactId: number, data: Partial<Contact>) =>
    fetchApi<Contact>(`/bookings/accounts/${accountId}/contacts/${contactId}/`, { method: "PATCH", body: JSON.stringify(data) }),
  deleteContact: (accountId: number, contactId: number) =>
    fetchApi<void>(`/bookings/accounts/${accountId}/contacts/${contactId}/`, { method: "DELETE" }),

  // Bookings: Venues
  getVenues: () => fetchApi<Venue[]>("/bookings/venues/"),
  getVenue: (id: number) => fetchApi<Venue>(`/bookings/venues/${id}/`),
  createVenue: (data: Partial<Venue>) =>
    fetchApi<Venue>("/bookings/venues/", { method: "POST", body: JSON.stringify(data) }),
  updateVenue: (id: number, data: Partial<Venue>) =>
    fetchApi<Venue>(`/bookings/venues/${id}/`, { method: "PATCH", body: JSON.stringify(data) }),

  // Bookings: Product Lines & Users
  getProductLines: () => fetchApi<ProductLine[]>("/bookings/product-lines/"),
  getUsers: () => fetchApi<AuthUser[]>("/bookings/users/"),

  // Bookings: Leads
  getLeads: (filters?: LeadFilters) => {
    const params = new URLSearchParams();
    if (filters) {
      Object.entries(filters).forEach(([key, val]) => {
        if (val) params.set(key, val);
      });
    }
    const qs = params.toString();
    return fetchApi<Lead[]>(`/bookings/leads/${qs ? `?${qs}` : ""}`);
  },
  bulkUpdateLeads: (ids: number[], action: string, value?: string | number | null) =>
    fetchApi<{ updated: number }>("/bookings/leads/bulk/", {
      method: "POST",
      body: JSON.stringify({ ids, action, value }),
    }),
  getLead: (id: number) => fetchApi<Lead>(`/bookings/leads/${id}/`),
  createLead: (data: Partial<Lead>) =>
    fetchApi<Lead>("/bookings/leads/", { method: "POST", body: JSON.stringify(data) }),
  updateLead: (id: number, data: Partial<Lead>) =>
    fetchApi<Lead>(`/bookings/leads/${id}/`, { method: "PATCH", body: JSON.stringify(data) }),
  transitionLead: (id: number, status: string, extra?: { lost_reason_option?: number; lost_notes?: string }) =>
    fetchApi<Lead>(`/bookings/leads/${id}/transition/`, { method: "POST", body: JSON.stringify({ status, ...extra }) }),
  convertLead: (id: number) =>
    fetchApi<Quote>(`/bookings/leads/${id}/convert/`, { method: "POST" }),
  createQuoteFromLead: (id: number) =>
    fetchApi<Quote>(`/bookings/leads/${id}/create-quote/`, { method: "POST" }),
  markLeadWon: (id: number, data: { create_event?: boolean; quote_id?: number }) =>
    fetchApi<Lead>(`/bookings/leads/${id}/won/`, { method: "POST", body: JSON.stringify(data) }),
  createEventFromLead: (id: number, data?: { quote_id?: number }) =>
    fetchApi<EventData>(`/bookings/leads/${id}/create-event/`, { method: "POST", body: JSON.stringify(data || {}) }),
  getLeadActivity: (id: number) =>
    fetchApi<ActivityLogEntry[]>(`/bookings/leads/${id}/activity/`),

  // Dashboard
  getDashboardStats: (period: string = "today", dateFrom?: string, dateTo?: string) => {
    const params = new URLSearchParams({ period });
    if (dateFrom) params.set("date_from", dateFrom);
    if (dateTo) params.set("date_to", dateTo);
    return fetchApi<DashboardStats>(`/bookings/dashboard/stats/?${params.toString()}`);
  },
  autoAssignLeads: () =>
    fetchApi<AutoAssignResult>("/bookings/leads/auto-assign/", { method: "POST" }),

  // Bookings: Quotes
  getQuotes: (status?: string) => fetchApi<Quote[]>(`/bookings/quotes/${status ? `?status=${status}` : ""}`),
  getQuote: (id: number) => fetchApi<Quote>(`/bookings/quotes/${id}/`),
  createQuote: (data: Partial<Quote> & { dish_ids?: number[] }) =>
    fetchApi<Quote>("/bookings/quotes/", { method: "POST", body: JSON.stringify(data) }),
  updateQuote: (id: number, data: Partial<Quote> & { dish_ids?: number[] }) =>
    fetchApi<Quote>(`/bookings/quotes/${id}/`, { method: "PATCH", body: JSON.stringify(data) }),
  transitionQuote: (id: number, status: string) =>
    fetchApi<Quote>(`/bookings/quotes/${id}/transition/`, { method: "POST", body: JSON.stringify({ status }) }),
  downloadQuotePDF: async (id: number): Promise<Blob> => {
    const res = await fetch(`${API_BASE}/bookings/quotes/${id}/pdf/`, {
      credentials: "include",
      headers: buildHeaders(),
    });
    if (!res.ok) {
      const text = await res.text();
      throw new Error(sanitizeError(res.status, text));
    }
    return res.blob();
  },
  getQuoteLineItems: (quoteId: number) =>
    fetchApi<QuoteLineItem[]>(`/bookings/quotes/${quoteId}/items/`),
  createQuoteLineItem: (quoteId: number, data: Partial<QuoteLineItem>) =>
    fetchApi<QuoteLineItem>(`/bookings/quotes/${quoteId}/items/`, { method: "POST", body: JSON.stringify(data) }),
  updateQuoteLineItem: (quoteId: number, itemId: number, data: Partial<QuoteLineItem>) =>
    fetchApi<QuoteLineItem>(`/bookings/quotes/${quoteId}/items/${itemId}/`, { method: "PATCH", body: JSON.stringify(data) }),
  deleteQuoteLineItem: (quoteId: number, itemId: number) =>
    fetchApi<void>(`/bookings/quotes/${quoteId}/items/${itemId}/`, { method: "DELETE" }),

  // Staff & Labor
  getLaborRoles: () => fetchApi<LaborRole[]>("/staff/labor-roles/"),
  createLaborRole: (data: Partial<LaborRole>) =>
    fetchApi<LaborRole>("/staff/labor-roles/", { method: "POST", body: JSON.stringify(data) }),
  updateLaborRole: (id: number, data: Partial<LaborRole>) =>
    fetchApi<LaborRole>(`/staff/labor-roles/${id}/`, { method: "PATCH", body: JSON.stringify(data) }),
  deleteLaborRole: (id: number) =>
    fetchApi<void>(`/staff/labor-roles/${id}/`, { method: "DELETE" }),
  getStaff: () => fetchApi<StaffMember[]>("/staff/members/"),
  getStaffMember: (id: number) => fetchApi<StaffMember>(`/staff/members/${id}/`),
  createStaffMember: (data: Partial<StaffMember>) =>
    fetchApi<StaffMember>("/staff/members/", { method: "POST", body: JSON.stringify(data) }),
  updateStaffMember: (id: number, data: Partial<StaffMember>) =>
    fetchApi<StaffMember>(`/staff/members/${id}/`, { method: "PATCH", body: JSON.stringify(data) }),

  // Shifts
  getShifts: (eventId?: number) =>
    fetchApi<Shift[]>(`/staff/shifts/${eventId ? `?event=${eventId}` : ""}`),
  createShift: (data: Partial<Shift>) =>
    fetchApi<Shift>("/staff/shifts/", { method: "POST", body: JSON.stringify(data) }),
  updateShift: (id: number, data: Partial<Shift>) =>
    fetchApi<Shift>(`/staff/shifts/${id}/`, { method: "PATCH", body: JSON.stringify(data) }),
  deleteShift: (id: number) =>
    fetchApi<void>(`/staff/shifts/${id}/`, { method: "DELETE" }),

  // Allocation Rules
  getAllocationRules: () => fetchApi<AllocationRule[]>("/staff/allocation-rules/"),
  createAllocationRule: (data: Partial<AllocationRule>) =>
    fetchApi<AllocationRule>("/staff/allocation-rules/", { method: "POST", body: JSON.stringify(data) }),
  updateAllocationRule: (id: number, data: Partial<AllocationRule>) =>
    fetchApi<AllocationRule>(`/staff/allocation-rules/${id}/`, { method: "PATCH", body: JSON.stringify(data) }),
  deleteAllocationRule: (id: number) =>
    fetchApi<void>(`/staff/allocation-rules/${id}/`, { method: "DELETE" }),

  // Staff Reports
  getStaffReport: (params?: { date_from?: string; date_to?: string }) => {
    const searchParams = new URLSearchParams();
    if (params?.date_from) searchParams.set("date_from", params.date_from);
    if (params?.date_to) searchParams.set("date_to", params.date_to);
    const qs = searchParams.toString();
    return fetchApi<StaffReportEntry[]>(`/staff/reports/${qs ? `?${qs}` : ""}`);
  },

  // Equipment
  getEquipment: () => fetchApi<EquipmentItem[]>("/equipment/items/"),
  createEquipmentItem: (data: Partial<EquipmentItem>) =>
    fetchApi<EquipmentItem>("/equipment/items/", { method: "POST", body: JSON.stringify(data) }),
  updateEquipmentItem: (id: number, data: Partial<EquipmentItem>) =>
    fetchApi<EquipmentItem>(`/equipment/items/${id}/`, { method: "PATCH", body: JSON.stringify(data) }),

  // Equipment Reservations
  getReservations: (eventId?: number) =>
    fetchApi<EquipmentReservation[]>(`/equipment/reservations/${eventId ? `?event=${eventId}` : ""}`),
  createReservation: (data: Partial<EquipmentReservation>) =>
    fetchApi<EquipmentReservation>("/equipment/reservations/", { method: "POST", body: JSON.stringify(data) }),
  updateReservation: (id: number, data: Partial<EquipmentReservation>) =>
    fetchApi<EquipmentReservation>(`/equipment/reservations/${id}/`, { method: "PATCH", body: JSON.stringify(data) }),
  deleteReservation: (id: number) =>
    fetchApi<void>(`/equipment/reservations/${id}/`, { method: "DELETE" }),

  // Bookings: Invoices
  getInvoices: (params?: { event?: number; status?: string }) => {
    const searchParams = new URLSearchParams();
    if (params?.event) searchParams.set("event", params.event.toString());
    if (params?.status) searchParams.set("status", params.status);
    const qs = searchParams.toString();
    return fetchApi<Invoice[]>(`/bookings/invoices/${qs ? `?${qs}` : ""}`);
  },
  getInvoice: (id: number) => fetchApi<Invoice>(`/bookings/invoices/${id}/`),
  createInvoice: (data: Partial<Invoice>) =>
    fetchApi<Invoice>("/bookings/invoices/", { method: "POST", body: JSON.stringify(data) }),
  updateInvoice: (id: number, data: Partial<Invoice>) =>
    fetchApi<Invoice>(`/bookings/invoices/${id}/`, { method: "PATCH", body: JSON.stringify(data) }),

  // Bookings: Payments
  getPayments: (invoiceId: number) =>
    fetchApi<Payment[]>(`/bookings/invoices/${invoiceId}/payments/`),
  createPayment: (invoiceId: number, data: Partial<Payment>) =>
    fetchApi<Payment>(`/bookings/invoices/${invoiceId}/payments/`, { method: "POST", body: JSON.stringify(data) }),

  // Choice Options
  getEventTypes: () => fetchApi<ChoiceOption[]>("/bookings/event-types/"),
  getServiceStyles: () => fetchApi<ChoiceOption[]>("/bookings/service-styles/"),
  getSources: () => fetchApi<ChoiceOption[]>("/bookings/sources/"),
  getLeadStatuses: () => fetchApi<ChoiceOption[]>("/bookings/lead-statuses/"),
  getLostReasons: () => fetchApi<ChoiceOption[]>("/bookings/lost-reasons/"),
  getMealTypes: () => fetchApi<ChoiceOption[]>("/bookings/meal-types/"),
  getArrangementTypes: () => fetchApi<ChoiceOption[]>("/bookings/arrangement-types/"),

  // Settings
  getSiteSettings: () => fetchApi<SiteSettingsData>("/bookings/settings/"),
  updateSiteSettings: (data: Partial<SiteSettingsData>) =>
    fetchApi<SiteSettingsData>("/bookings/settings/", { method: "PATCH", body: JSON.stringify(data) }),

  // Reminders
  getReminders: (params?: { status?: string; due_before?: string; due_after?: string; lead?: number }) => {
    const searchParams = new URLSearchParams();
    if (params?.status) searchParams.set("status", params.status);
    if (params?.due_before) searchParams.set("due_before", params.due_before);
    if (params?.due_after) searchParams.set("due_after", params.due_after);
    if (params?.lead) searchParams.set("lead", params.lead.toString());
    const qs = searchParams.toString();
    return fetchApi<Reminder[]>(`/bookings/reminders/${qs ? `?${qs}` : ""}`);
  },
  getReminderCounts: () => fetchApi<ReminderCounts>("/bookings/reminders/counts/"),
  getLeadReminders: (leadId: number) =>
    fetchApi<Reminder[]>(`/bookings/leads/${leadId}/reminders/`),
  createReminder: (leadId: number, data: Partial<Reminder>) =>
    fetchApi<Reminder>(`/bookings/leads/${leadId}/reminders/`, { method: "POST", body: JSON.stringify(data) }),
  updateReminder: (id: number, data: Partial<Reminder>) =>
    fetchApi<Reminder>(`/bookings/reminders/${id}/`, { method: "PATCH", body: JSON.stringify(data) }),
  deleteReminder: (id: number) =>
    fetchApi<void>(`/bookings/reminders/${id}/`, { method: "DELETE" }),
};
