const API_BASE = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000/api";

async function fetchApi<T>(path: string, options?: RequestInit): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`, {
    headers: { "Content-Type": "application/json", ...options?.headers },
    ...options,
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`API error ${res.status}: ${text}`);
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
  is_vegetarian: boolean;
  notes: string;
}

export interface MenuTemplate {
  id: number;
  name: string;
  description: string;
  default_gents: number;
  default_ladies: number;
  dish_count: number;
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
  budget_range: number | null;
  budget_range_label: string | null;
  event_type: string;
  event_type_display: string;
  service_style: string;
  notes: string;
  status: string;
  status_display: string;
  converted_to_quote: number | null;
  lost_reason: string;
  contacted_at: string | null;
  qualified_at: string | null;
  converted_at: string | null;
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
  is_active: boolean;
  created_at: string;
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

// Settings types
export interface BudgetRangeOption {
  id: number;
  label: string;
  sort_order: number;
  is_active: boolean;
}

export interface SiteSettingsData {
  currency_symbol: string;
  currency_code: string;
  default_price_per_head: string;
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
  service_style: string;
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
  shifts: Shift[];
  equipment_reservations: EquipmentReservation[];
  invoices: Invoice[];
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

// API functions
export const api = {
  getDishes: () => fetchApi<Dish[]>("/dishes/"),
  getCategories: () => fetchApi<DishCategory[]>("/categories/"),
  getMenus: () => fetchApi<MenuTemplate[]>("/menus/"),
  getMenu: (id: number) => fetchApi<MenuTemplateDetail>(`/menus/${id}/`),
  getMenuPreview: (id: number) => fetchApi<CalculationResult>(`/menus/${id}/preview/`),
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
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(data),
    });
    if (!res.ok) {
      const text = await res.text();
      throw new Error(`API error ${res.status}: ${text}`);
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

  // Bookings: Leads
  getLeads: (status?: string) => fetchApi<Lead[]>(`/bookings/leads/${status ? `?status=${status}` : ""}`),
  getLead: (id: number) => fetchApi<Lead>(`/bookings/leads/${id}/`),
  createLead: (data: Partial<Lead>) =>
    fetchApi<Lead>("/bookings/leads/", { method: "POST", body: JSON.stringify(data) }),
  updateLead: (id: number, data: Partial<Lead>) =>
    fetchApi<Lead>(`/bookings/leads/${id}/`, { method: "PATCH", body: JSON.stringify(data) }),
  transitionLead: (id: number, status: string) =>
    fetchApi<Lead>(`/bookings/leads/${id}/transition/`, { method: "POST", body: JSON.stringify({ status }) }),
  convertLead: (id: number) =>
    fetchApi<Quote>(`/bookings/leads/${id}/convert/`, { method: "POST" }),

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
      headers: { "Content-Type": "application/json" },
    });
    if (!res.ok) {
      const text = await res.text();
      throw new Error(`API error ${res.status}: ${text}`);
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

  // Bookings: Staff & Labor
  getLaborRoles: () => fetchApi<LaborRole[]>("/bookings/labor-roles/"),
  createLaborRole: (data: Partial<LaborRole>) =>
    fetchApi<LaborRole>("/bookings/labor-roles/", { method: "POST", body: JSON.stringify(data) }),
  updateLaborRole: (id: number, data: Partial<LaborRole>) =>
    fetchApi<LaborRole>(`/bookings/labor-roles/${id}/`, { method: "PATCH", body: JSON.stringify(data) }),
  getStaff: () => fetchApi<StaffMember[]>("/bookings/staff/"),
  getStaffMember: (id: number) => fetchApi<StaffMember>(`/bookings/staff/${id}/`),
  createStaffMember: (data: Partial<StaffMember>) =>
    fetchApi<StaffMember>("/bookings/staff/", { method: "POST", body: JSON.stringify(data) }),
  updateStaffMember: (id: number, data: Partial<StaffMember>) =>
    fetchApi<StaffMember>(`/bookings/staff/${id}/`, { method: "PATCH", body: JSON.stringify(data) }),

  // Bookings: Shifts
  getShifts: (eventId?: number) =>
    fetchApi<Shift[]>(`/bookings/shifts/${eventId ? `?event=${eventId}` : ""}`),
  createShift: (data: Partial<Shift>) =>
    fetchApi<Shift>("/bookings/shifts/", { method: "POST", body: JSON.stringify(data) }),
  updateShift: (id: number, data: Partial<Shift>) =>
    fetchApi<Shift>(`/bookings/shifts/${id}/`, { method: "PATCH", body: JSON.stringify(data) }),
  deleteShift: (id: number) =>
    fetchApi<void>(`/bookings/shifts/${id}/`, { method: "DELETE" }),

  // Bookings: Equipment
  getEquipment: () => fetchApi<EquipmentItem[]>("/bookings/equipment/"),
  createEquipmentItem: (data: Partial<EquipmentItem>) =>
    fetchApi<EquipmentItem>("/bookings/equipment/", { method: "POST", body: JSON.stringify(data) }),
  updateEquipmentItem: (id: number, data: Partial<EquipmentItem>) =>
    fetchApi<EquipmentItem>(`/bookings/equipment/${id}/`, { method: "PATCH", body: JSON.stringify(data) }),

  // Bookings: Equipment Reservations
  getReservations: (eventId?: number) =>
    fetchApi<EquipmentReservation[]>(`/bookings/equipment-reservations/${eventId ? `?event=${eventId}` : ""}`),
  createReservation: (data: Partial<EquipmentReservation>) =>
    fetchApi<EquipmentReservation>("/bookings/equipment-reservations/", { method: "POST", body: JSON.stringify(data) }),
  updateReservation: (id: number, data: Partial<EquipmentReservation>) =>
    fetchApi<EquipmentReservation>(`/bookings/equipment-reservations/${id}/`, { method: "PATCH", body: JSON.stringify(data) }),
  deleteReservation: (id: number) =>
    fetchApi<void>(`/bookings/equipment-reservations/${id}/`, { method: "DELETE" }),

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

  // Settings
  getBudgetRanges: () => fetchApi<BudgetRangeOption[]>("/bookings/budget-ranges/"),
  getSiteSettings: () => fetchApi<SiteSettingsData>("/bookings/settings/"),
};
