const API_BASE = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000/api";

export interface AuthUser {
  id: number;
  email: string;
  first_name: string;
  last_name: string;
  role: string;
  organisation: { id: number; name: string } | null;
  is_superuser?: boolean;
  all_orgs?: boolean; // superuser viewing all orgs (no single active org)
}

export interface ManagedUser {
  id: number;
  email: string;
  first_name: string;
  last_name: string;
  role: string;
  is_active: boolean;
  product_lines: number[];
  product_line_names: string[];
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

// Flatten DRF validation errors ({field: [msg], nested: [{f: [msg]}]}) into
// readable sentences instead of dumping raw JSON in the UI.
export function collectErrorMessages(node: unknown, prefix = ""): string[] {
  if (typeof node === "string") return [prefix ? `${prefix}: ${node}` : node];
  if (Array.isArray(node)) return node.flatMap((n) => collectErrorMessages(n, prefix));
  if (node && typeof node === "object") {
    return Object.entries(node).flatMap(([k, v]) => {
      const label = k.replace(/_/g, " ");
      return collectErrorMessages(v, prefix ? `${prefix} ${label}` : label);
    });
  }
  return [];
}

function sanitizeError(status: number, text: string): string {
  if (status >= 500) {
    // A 5xx body is usually a stack trace or the gateway's own HTML, and must
    // never reach a user. But our transport failures answer 502 with JSON whose
    // `detail` is the only thing the rep can act on — blanket-discarding it is
    // how a revoked mailbox surfaced as "Server error (502)" with the real
    // reason sitting unread in the response (REL-481). Show a structured
    // detail; fall back to the status for anything we didn't author.
    try {
      const json = JSON.parse(text);
      const detail = (json as { detail?: unknown })?.detail;
      if (typeof detail === "string" && detail.trim()) return detail;
    } catch { /* not JSON — almost certainly not ours */ }
    return `Server error (${status})`;
  }
  try {
    const json = JSON.parse(text);
    if (typeof json === "string") return json;
    if (json && typeof json === "object" && typeof (json as { detail?: unknown }).detail === "string") {
      return (json as { detail: string }).detail;
    }
    const messages = collectErrorMessages(json);
    if (messages.length) return messages.slice(0, 4).join(" ");
  } catch { /* not JSON */ }
  return text.length > 200 ? text.slice(0, 200) + "…" : text;
}

// When the backend gate returns 402 (inactive subscription), send the user to
// the billing page so they can subscribe. The billing page's own calls are
// exempt from the gate, so this never loops.
function redirectToBilling() {
  if (typeof window !== "undefined" && window.location.pathname !== "/billing") {
    window.location.href = "/billing";
  }
}

// A 401 from these three is the answer itself, not a stale access token:
// refreshing on a failed refresh recurses, and refreshing on a rejected login
// would hide a wrong password behind a retry. Every *other* /auth/ endpoint is
// an ordinary authenticated call and must be allowed to refresh like any other
// path. /auth/me/ especially — it is the first call the app makes, so excluding
// it meant an expired access token logged the user out on the spot while a
// perfectly good refresh token sat unused in the cookie jar (REL-477).
const NO_REFRESH_PATHS = ["/auth/login/", "/auth/logout/", "/auth/refresh/"];

function canRefresh(path: string): boolean {
  return !NO_REFRESH_PATHS.some((p) => path.startsWith(p));
}

async function fetchApi<T>(path: string, options?: RequestInit): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`, {
    credentials: "include",
    headers: buildHeaders(options),
    ...options,
  });
  if (res.status === 402) {
    redirectToBilling();
    throw new Error("subscription_required");
  }
  if (res.status === 401 && canRefresh(path)) {
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
      return retry.status === 204 ? (undefined as T) : retry.json();
    }
    throw new Error("Unauthorized");
  }
  if (!res.ok) {
    const text = await res.text();
    throw new Error(sanitizeError(res.status, text));
  }
  return res.status === 204 ? (undefined as T) : res.json();
}

/** DRF paginated response shape. */
export interface PaginatedResponse<T> {
  count: number;
  next: string | null;
  previous: string | null;
  results: T[];
}

/** Unwrap DRF paginated response {count, results} or return raw array. */
function unwrapResults<T>(data: T[] | { count: number; results: T[] }): T[] {
  if (Array.isArray(data)) return data;
  if (data && typeof data === "object" && "results" in data) return data.results;
  return data as T[];
}

/** Fetch a list endpoint and unwrap paginated results. */
async function fetchList<T>(path: string, options?: RequestInit): Promise<T[]> {
  const data = await fetchApi<T[] | { count: number; results: T[] }>(path, options);
  return unwrapResults(data);
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

/** A booking's course (REL-417): Starter/Entrée/Dessert. Service style is
 * booking-level, not per-course. */
export interface CourseData {
  name: string;
  sort_order: number;
}

/** Which dishes are offered as an entrée choice (REL-419), `{dish_id: tally}`. The
 * tally is null until the finals arrive — on a quote it is always null. */
export type MenuChoices = Record<string, number | null>;

/** A course of the menu as the CLIENT sees it, rendered server-side: offered dishes
 * are already collapsed into one "Choice of: A / B / C" line (REL-419 AC13). The same
 * shape the sign page and both PDFs render, so the in-app page can't drift from the
 * contract. `null` when the booking defines no courses. */
export type MenuLineGroup = { name: string; items: string[] };

/** Derived finals state of a confirmed event (REL-419) — never a stored column.
 * `null` when there is nothing to chase (unconfirmed, or no due date set). */
export type FinalsStatus = "awaiting" | "due_soon" | "overdue" | "recorded" | null;

/** One row of a booking's event-day run-of-show. `time` is 24h "HH:MM:SS" as the
 * API stores it; a booking with no entries falls back to its four legacy time
 * fields. */
export interface TimelineEntry {
  id: number;
  time: string;
  label: string;
  /** "YYYY-MM-DD" when the step is on a different day from the booking's event
   * date (a load-in the afternoon before); null when it's on the day itself. */
  date: string | null;
  sort_order: number;
}

export interface DietaryTag {
  id: number;
  slug: string;
  label: string;
  short_label: string;
  kind: "dietary" | "allergen";
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
  is_active?: boolean;
  /** Read-only per-head surcharge for adding this dish (auto-derived from cost). */
  addition_surcharge?: string;
  /** Dietary/allergen labels; a dish with none is simply untagged. */
  dietary_tags?: DietaryTag[];
  /** Write-only: the dietary-tag ids to set (the manage endpoint). */
  dietary_tag_ids?: number[];
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
  courses: CourseData[];                     // REL-417 — carried onto a booking on apply
  dish_courses: Record<string, number>;      // {dish_id: course index}
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

export interface AddOnVariant {
  id: number;
  name: string;
  unit_price: string;
  is_active: boolean;
  sort_order: number;
}

export interface AddOnProduct {
  id: number;
  name: string;
  category: string;
  default_unit: string;
  unit_price: string;
  is_taxable: boolean;
  is_featured: boolean;
  is_active: boolean;
  sort_order: number;
  variants: AddOnVariant[];
}

export interface Contact {
  id: number;
  title?: string;
  first_name?: string;
  last_name?: string;
  account: number | null;
  name: string;
  email: string;
  phone: string;
  address: string;
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
  colour: string;
  is_active: boolean;
  is_default?: boolean;
}

export interface Lead {
  id: number;
  account: number | null;
  account_name: string | null;
  contact_title: string;
  contact_name: string;
  contact_first_name: string;
  contact_last_name: string;
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
  unread_whatsapp_count: number;
  has_unread_whatsapp: boolean;
}

export interface QuoteLineItem {
  id: number;
  quote: number | null;
  event: number | null;
  variant: number | null;
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
  primary_contact: number | null;
  contact_name: string | null;
  contact_email: string | null;
  contact_phone: string | null;
  is_b2b: boolean;
  account: number | null;
  account_name: string | null;
  version: number;
  status: string;
  status_display: string;
  is_editable: boolean;
  event_date: string;
  venue: number | null;
  venue_name: string | null;
  venue_address: string;
  product: number | null;
  product_name: string | null;
  guest_count: number;
  gents: number;
  ladies: number;
  guest_counts?: { segment: string; count: number; counts_toward_total: boolean; price_per_head?: string | null }[];
  big_eaters: boolean;
  big_eaters_percentage: number;
  setup_time: string | null;
  guest_arrival_time: string | null;
  meal_time: string | null;
  end_time: string | null;
  /** The booking's own run-of-show; empty ⇒ the four fields above render instead. */
  timeline_entries?: TimelineEntry[];
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
  service_charge_pct: string;
  service_charge_taxable: boolean;
  service_charge: string;
  gratuity_pct: string;
  gratuity: string;
  total: string;
  dishes: number[];
  dish_names: string[];
  courses: CourseData[];
  dish_courses: Record<string, number>;
  menu_choices: MenuChoices;
  menu_lines: MenuLineGroup[] | null;
  based_on_template: number | null;
  notes: string;
  internal_notes: string;
  sent_at: string | null;
  accepted_at: string | null;
  public_token: string | null;
  signature: BookingSignatureInfo | null;
  event: number | null;
  event_id: number | null;
  created_by: number | null;
  created_by_name: string | null;
  assigned_to: number | null;
  assigned_to_name: string | null;
  line_items: QuoteLineItem[];
  additional_meals: EventMealData[];
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
  first_name?: string;
  last_name?: string;
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

// A client payment recorded against an event (advance / part / full).
// Distinct from the invoice-scoped Payment above and from SaaS subscription billing.
export interface EventPayment {
  id: number;
  event: number;
  amount: string;
  payment_date: string;
  method: string;
  method_display: string;
  received_by: number | null;
  received_by_name: string | null;
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
  service_charge_pct: string;
  service_charge_taxable: boolean;
  service_charge: string;
  gratuity_pct: string;
  gratuity: string;
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
  // Lead-status only — present on LeadStatusOption.
  color?: string;
  is_default?: boolean;
  is_won?: boolean;
  is_lost?: boolean;
  // Service-style only — whether a booking in this style can offer the guest a
  // choice of dish (REL-452). Read by the booking pages, not just Settings.
  guests_choose?: boolean;
  // Timeline-step only — these two make the preset list double as the org's
  // standard-day template ("+ Build a run-of-show" seeds from them).
  in_standard_day?: boolean;
  standard_day_offset_minutes?: number | null;
}

// Settings types
export interface SiteSettingsData {
  currency_symbol: string;
  currency_code: string;
  date_format: string;
  date_format_choices?: { value: string; label: string }[];
  time_format?: string;
  time_format_choices?: { value: string; label: string }[];
  timezone: string;
  default_price_per_head: string;
  default_guest_profile?: string;
  target_food_cost_percentage: string;
  price_rounding_step: string;
  quotation_terms: string;
  tax_label: string;
  default_tax_rate: string;
  service_charge_default_pct?: string;
  service_charge_taxable_default?: boolean;
  gratuity_default_pct?: string;
  guest_segments?: { name: string; is_default: boolean; counts_toward_total: boolean; price_multiplier: string; sort_order: number }[];
  // Commission & targets (model/rate are per-plan; choices kept for the plan form)
  commission_model_choices?: { value: string; label: string }[];
  target_period?: string;
  target_period_choices?: { value: string; label: string }[];
  commission_basis?: string;
  commission_basis_choices?: { value: string; label: string }[];
  fiscal_year_start_month?: number;
  fiscal_year_start_month_choices?: { value: number; label: string }[];
  // WhatsApp
  whatsapp_enabled?: boolean;
  whatsapp_shortcuts_enabled?: boolean;
  twilio_configured?: boolean;
  /** Which channel the send modal preselects (REL-445). */
  default_client_channel?: string;
  twilio_whatsapp_number?: string;
  // AI follow-ups
  ai_followups_enabled?: boolean;
  ai_followups_configured?: boolean;
  followup_gap_first_days?: number;
  followup_gap_second_days?: number;
  followup_gap_final_days?: number;
  followup_max_drafts_per_lead?: number;
  followup_auto_generate?: boolean;
  /** Platform launch flag (env OPERATIONS_ENABLED). Hidden for now; gates the
   *  operations suite — portioning, kitchen events, staffing and the portioning
   *  Help page. Equipment/Menu Templates are admin-only, not gated by this. */
  operations_enabled?: boolean;
}

export interface CommissionPlanConfig {
  id: number;
  name: string;
  commission_model: string;
  commission_flat_rate: string;
  is_default: boolean;
}

export interface CommissionBandConfig {
  id: number;
  plan: number;
  min_attainment_pct: string;
  rate: string;
}

export interface TargetColumn {
  index: number;
  label: string;
}
export interface TargetRepRow {
  user_id: number;
  user_name: string;
  plan: number | null;
  cells: Record<number, string>; // period_index -> amount
  total: string;
}
export interface SalesTargetGrid {
  period_type: string;
  fiscal_year: number;
  fiscal_year_label: string;
  fiscal_start_month: number;
  columns: TargetColumn[];
  reps: TargetRepRow[];
}

// Event type (updated with booking fields)
export interface EventData {
  id: number;
  name: string;
  date: string;
  guest_count: number;
  gents: number;
  ladies: number;
  guest_counts?: { segment: string; count: number; counts_toward_total: boolean; price_per_head?: string | null }[];
  big_eaters: boolean;
  big_eaters_percentage: number;
  dishes: number[];
  courses: CourseData[];
  dish_courses: Record<string, number>;
  menu_choices: MenuChoices;
  menu_lines: MenuLineGroup[] | null;
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
  is_b2b: boolean;
  account: number | null;
  account_name: string | null;
  product: number | null;
  product_name: string | null;
  assigned_to: number | null;
  assigned_to_name: string | null;
  created_by: number | null;
  created_by_name: string | null;
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
  is_taxable: boolean;
  tax_rate: string;
  // Computed totals (food + add-on line items + tax) — server-side via the shared engine.
  subtotal: string;
  tax_amount: string;
  service_charge_pct: string;
  service_charge_taxable: boolean;
  service_charge: string;
  gratuity_pct: string;
  gratuity: string;
  total: string;
  // Timeline
  setup_time: string | null;
  guest_arrival_time: string | null;
  meal_time: string | null;
  end_time: string | null;
  /** The booking's own run-of-show; empty ⇒ the four fields above render instead. */
  timeline_entries?: TimelineEntry[];
  // Guest counts
  guaranteed_count: number | null;
  final_count: number | null;
  final_count_due: string | null;
  /** Derived on the backend from (confirmed + final_count vs final_count_due). */
  finals_status: FinalsStatus;
  // Which BEO revision this event is on. Read-only: downloading never moves it —
  // only the explicit "New revision" action does (REL-444).
  beo_revision: number;
  beo_revised_at: string | null;
  // Nested
  source_quote_id: number | null;
  contact_phone: string | null;
  public_token: string | null;
  signature: BookingSignatureInfo | null;
  line_items: QuoteLineItem[];
  additional_meals: EventMealData[];
  shifts: Shift[];
  equipment_reservations: EquipmentReservation[];
  invoices: Invoice[];
  // Client payment tracking (advances / part / full)
  payments: EventPayment[];
  amount_paid: string;
  balance_due: string;
  payment_status: string;
}

export interface EventMealData {
  id?: number;
  label: string;
  /** Who the meal serves (REL-426): custom | everyone | guests | segment. */
  audience?: string;
  /** Segment NAME served when audience==="segment". */
  audience_segment?: string | null;
  guest_count: number;
  price_per_head: string | null;
  dishes: number[];
  dish_ids?: number[];
  based_on_template: number | null;
  meal_time: string | null;
  notes: string;
  dish_comments?: EventDishComment[];
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
  lead_phone?: string;
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

// WhatsApp
export interface WhatsAppMessage {
  id: number;
  lead: number | null;
  quote: number | null;
  event: number | null;
  reminder: number | null;
  channel: ClientChannel;
  to_phone: string;
  from_phone: string;
  to_email: string;
  /** The address or number actually used, whichever the channel was. */
  recipient: string;
  subject: string;
  body: string;
  attachment_filename: string;
  direction: string;
  status: string;
  twilio_sid: string;
  provider_message_id: string;
  error_code: string;
  error_message: string;
  sent_by: number | null;
  sent_by_name: string | null;
  /** True when the platform sent it without anyone clicking send. */
  is_automatic: boolean;
  created_at: string;
  updated_at: string;
}

// Client messaging (REL-445)
export type ClientChannel = "email" | "whatsapp";
export type ClientMessageKind = "sign_link" | "signed_copy" | "compose";

/** Why a channel can't be used. The three email causes are deliberately
 * distinct: two are org problems with different fixes, one is a record problem. */
export type ChannelBlockedReason =
  | "no_mailbox"
  | "mailbox_needs_reconnect"
  | "no_email_address"
  | "no_phone"
  | "whatsapp_disabled";

export interface ChannelAvailability {
  email: {
    available: boolean;
    reason: ChannelBlockedReason | null;
    address: string;
    /** The connected mailbox we'd send from. */
    mailbox: string;
  };
  whatsapp: {
    available: boolean;
    reason: ChannelBlockedReason | null;
    address: string;
    /** 'platform' can send unattended; 'shortcut' always needs a human tap. */
    mechanism: "platform" | "shortcut";
    number: string;
  };
  default_channel: ClientChannel;
}

export type ClientMessageParent = "quote" | "event" | "lead";

/** Quotes and leads hang off /bookings/, events off /events/ — the only thing
 * that differs between the three messaging surfaces. */
export function clientMessageBase(parent: ClientMessageParent, id: number): string {
  if (parent === "event") return `/events/${id}`;
  if (parent === "lead") return `/bookings/leads/${id}`;
  return `/bookings/quotes/${id}`;
}

export interface ClientMessageDraft {
  subject: string;
  body: string;
  used_fallback: boolean;
  model_used: string;
  kind: ClientMessageKind;
  channel: ClientChannel;
  link: string;
  attachment_filename: string;
  /** Whether this parent+channel could carry the booking PDF at all. */
  attachment_available: boolean;
  llm_available: boolean;
  availability: ChannelAvailability;
}

// Client email — the caterer's own connected mailbox
export type MailboxProvider = "google" | "microsoft";

export interface ConnectedMailbox {
  id: number;
  provider: MailboxProvider;
  provider_display: string;
  email_address: string;
  status: "connected" | "needs_reconnect";
  last_error: string;
  created_at: string;
  updated_at: string;
}

export interface MailboxStatus {
  connected: boolean;
  mailbox: ConnectedMailbox | null;
  providers_available: MailboxProvider[];
}

// AI follow-up drafts
export interface FollowUpStatsRow {
  user_id: number | null;
  name: string;
  to_review: number;
  due: number;
  sent: number;
}

export interface FollowUpStats {
  to_review: number;
  due: number;
  sent: number;
  breakdown?: FollowUpStatsRow[];
}

export interface FollowUpDraft {
  id: number;
  lead: number;
  lead_name: string | null;
  lead_phone?: string;
  lead_event_type?: string;
  lead_event_date?: string | null;
  lead_guest_estimate?: number | null;
  lead_assigned_to_name?: string | null;
  lead_days_stale?: number | null;
  channel: string;
  body: string;
  reasoning: string;
  status: "pending" | "sent" | "dismissed";
  model_used: string;
  whatsapp_message: number | null;
  reviewed_by: number | null;
  reviewed_by_name: string | null;
  reviewed_at: string | null;
  created_at: string;
}

// On-demand generation: the preview of stale leads the generator would draft for
export interface FollowUpPreviewLead {
  id: number;
  contact_name: string;
  days_stale: number;
  status: string;
  event_date: string | null;
  budget: string | null;
  assigned_to: number | null;
  assigned_to_name: string | null;
}

export interface FollowUpPreview {
  configured: boolean;
  first_gap_days: number;
  leads: FollowUpPreviewLead[];
}

export type FollowUpGenerateResult =
  | { status: "created"; draft: FollowUpDraft }
  | { status: "skipped"; reasoning: string }
  | { status: "ineligible"; detail: string };

// Calendar types
export interface CalendarEvent {
  id: number;
  name: string;
  status: string;
  guest_count: number;
  account_name: string | null;
  product_name: string | null;
  product_colour: string | null;
}

export interface CalendarDay {
  date: string;
  org_event_count: number;
  org_total_guests: number;
  my_event_count: number;
  my_total_guests: number;
  my_events: CalendarEvent[];
}

export interface LockedDate {
  id: number;
  date: string;
  reason: string;
  locked_by: number | null;
  locked_by_name: string | null;
  created_at: string;
}

export interface AutoAssignAssignment {
  salesperson: string;
  product_line: string;
  count: number;
}

export interface AutoAssignAssignment {
  salesperson: string;
  product_line: string;
  count: number;
}

export interface AutoAssignResult {
  assigned: number;
  skipped_no_product: number;
  skipped_no_staff: number;
  assignments: AutoAssignAssignment[];
}

export interface KanbanColumn {
  count: number;
  results: Lead[];
}

export interface KanbanResponse {
  columns: Record<string, KanbanColumn>;
  order?: string[];
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

export interface TargetAttainment {
  user_id: number;
  user_name: string;
  period: string;
  revenue: string;
  target: string;
  attainment_pct: string;
  commission: string;
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
  target_attainment: TargetAttainment[];
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

// My dashboard stats (salesperson)
export interface MyDashboardStats {
  pipeline: Record<string, number>;
  pipeline_value: string;
  kpis: {
    conversion_rate: number;
    avg_days_to_convert: number | null;
    total_active: number;
    unread_whatsapp_leads: number;
  };
  status_columns: { value: string; label: string }[];
  status_distribution: { status: string; label: string; count: number }[];
}

export interface CommissionBandRow {
  from_pct: string;
  to_pct: string | null;
  rate: string;
  revenue_in_band: string;
  commission: string;
}

export interface CommissionData {
  period: string;
  period_unit: string;
  period_start: string;
  period_end: string;
  model: string;
  plan: string | null;
  basis: string;
  revenue: string;
  target: string;
  attainment_pct: string;
  commission: string;
  deals: number;
  year_label: string;
  year_revenue: string;
  year_target: string;
  year_deals: number;
  breakdown: CommissionBandRow[];
}

// Lead filter params
export interface LeadFilters {
  search?: string;
  status?: string;
  assigned_to?: string;
  product?: string;
  event_type?: string;
  date_from?: string;
  date_to?: string;
  lead_date_from?: string;
  lead_date_to?: string;
  ordering?: string;
  page_size?: number | string;
  page?: number;
}

export type SubscriptionStatus =
  | "none"
  | "trialing"
  | "active"
  | "past_due"
  | "canceled"
  | "unpaid"
  | "incomplete"
  | "incomplete_expired";

export interface Subscription {
  status: SubscriptionStatus;
  plan_name: string;
  current_period_end: string | null;
  cancel_at_period_end: boolean;
  trial_ends_at: string | null;
  is_trialing: boolean;
  trial_days_remaining: number;
  has_access: boolean;
  has_billing_account: boolean;
  comped: boolean;
}

// A subscription tier, priced for the caller's org region (resolved server-side).
export interface Plan {
  code: string;
  name: string;
  description: string;
  display_amount: string;
  currency: string;
  currency_symbol: string;
}

// ── E-signature ──
export interface BookingSignatureInfo {
  signer_name: string;
  signed_at: string;
}

/** Customer-safe view of a booking behind a public sign token. */
export interface PublicBooking {
  kind: "quote" | "event";
  reference: string;
  business_name: string;
  currency_symbol: string;
  currency_code: string;
  tax_label: string;
  terms: string;
  customer_name: string | null;
  event_date: string | null;
  venue_name: string | null;
  venue_address: string;
  guest_count: number;
  gents: number;
  ladies: number;
  event_type: string;
  event_type_label: string;
  meal_type: string;
  meal_type_label: string;
  service_style: string;
  service_style_label: string;
  /** `time_display` is set for run-of-show entries (a bare time the client
   * can't parse); legacy slots leave it null and carry a full ISO datetime. */
  timeline: { label: string; time: string | null; time_display?: string | null }[];
  menu: { category: string; items: string[] }[];
  // Absent/null on a course-less booking, which renders the flat menu unchanged
  // (REL-417 AC4) — the sign page guards on it, so it is optional here too.
  menu_courses?: MenuLineGroup[] | null; // REL-417 grouping, REL-419 "Choice of"
  additional_meals: { label: string; guest_count: number; price_per_head: string | null; items: string[] }[];
  line_items: { description: string; category: string; quantity: string; unit: string; line_total: string }[];
  price_per_head: string | null;
  food_rows: { name: string; count: number; rate: string; amount: string }[] | null;
  subtotal: string;
  tax_rate: string;
  tax_amount: string;
  service_charge_pct: string;
  service_charge_taxable: boolean;
  service_charge: string;
  gratuity_pct: string;
  gratuity: string;
  total: string;
  notes: string;
  status: string;
  is_signed: boolean;
  signable: boolean;
  signer_name: string | null;
  signed_at: string | null;
}

export interface SignBookingPayload {
  signer_name: string;
  consent: boolean;
  signer_email?: string;
  signature_image?: string;
}

// API functions
export const api = {
  // Auth
  login: (email: string, password: string) =>
    fetchApi<AuthUser>("/auth/login/", {
      method: "POST",
      body: JSON.stringify({ email, password }),
    }),
  // Public Book-a-Demo request from the landing page. `referral_source` is the
  // honeypot — hidden from humans, so a filled one marks the caller as a bot.
  createDemoRequest: (data: {
    name: string;
    email: string;
    events_per_month?: string;
    referral_source?: string;
  }) =>
    fetchApi<{ name: string; email: string; events_per_month: string }>("/demo-requests/", {
      method: "POST",
      body: JSON.stringify(data),
    }),
  logout: async () => {
    await fetch(`${API_BASE}/auth/logout/`, { method: "POST", credentials: "include", headers: buildHeaders() });
  },
  getMe: () => fetchApi<AuthUser>("/auth/me/"),
  // Superuser org impersonation. orgId: a pk to enter that org, "all" for
  // all-orgs mode, or null to return to the superuser's own org.
  getOrganisations: () => fetchApi<{ id: number; name: string }[]>("/auth/organisations/"),
  switchOrg: (orgId: number | "all" | null) =>
    fetchApi<AuthUser>("/auth/switch-org/", { method: "POST", body: JSON.stringify({ org_id: orgId }) }),

  // Billing / subscription (SaaS plan for the org itself)
  getSubscription: () => fetchApi<Subscription>("/billing/subscription/"),
  getPlans: () => fetchApi<Plan[]>("/billing/plans/"),
  // Pass a plan code for a tier; omit to use the single default price (when no
  // tiers are configured). The backend resolves the region-specific price.
  startCheckout: (plan?: string) =>
    fetchApi<{ url: string }>("/billing/checkout/", {
      method: "POST",
      body: JSON.stringify(plan ? { plan } : {}),
    }),
  openBillingPortal: () =>
    fetchApi<{ url: string }>("/billing/portal/", { method: "POST" }),
  extendTrial: (orgId: number, days: number) =>
    fetchApi<Subscription>(`/billing/extend-trial/${orgId}/`, {
      method: "POST",
      body: JSON.stringify({ days }),
    }),

  getDishes: () => fetchList<Dish>("/dishes/?page_size=all"),
  getCategories: () => fetchList<DishCategory>("/categories/?page_size=all"),
  getDietaryTags: () => fetchList<DietaryTag>("/dietary-tags/?page_size=all"),
  // Dish catalog management (owner/admin) — includes inactive; supports create/update/delete.
  getManagedDishes: () => fetchList<Dish>("/dishes/manage/?page_size=all"),
  createDish: (data: Partial<Dish>) =>
    fetchApi<Dish>("/dishes/manage/", { method: "POST", body: JSON.stringify(data) }),
  updateDish: (id: number, data: Partial<Dish>) =>
    fetchApi<Dish>(`/dishes/manage/${id}/`, { method: "PATCH", body: JSON.stringify(data) }),
  deleteDish: (id: number) =>
    fetchApi<void>(`/dishes/manage/${id}/`, { method: "DELETE" }),
  getMenus: () => fetchList<MenuTemplate>("/menus/?page_size=all"),
  getMenu: (id: number) => fetchApi<MenuTemplateDetail>(`/menus/${id}/`),
  getMenuPreview: (id: number) => fetchApi<CalculationResult>(`/menus/${id}/preview/`),
  menuPriceCheck: (templateId: number, data: { guest_count: number; dish_ids: number[] }) =>
    fetchApi<PriceCheckResult>(`/menus/${templateId}/price-check/`, {
      method: "POST",
      body: JSON.stringify(data),
    }),
  priceEstimate: (data: {
    dish_ids: number[];
    guest_count: number;
    // A hearty-eater crowd is more food per head, so it is a higher rate per head.
    big_eaters?: boolean;
    big_eaters_percentage?: number;
  }) =>
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
  getEvents: (params?: { status?: string; date_from?: string; date_to?: string; page_size?: number }) => {
    const searchParams = new URLSearchParams();
    if (params?.status) searchParams.set("status", params.status);
    if (params?.date_from) searchParams.set("date_from", params.date_from);
    if (params?.date_to) searchParams.set("date_to", params.date_to);
    if (params?.page_size) searchParams.set("page_size", params.page_size.toString());
    const qs = searchParams.toString();
    return fetchList<EventData>(`/events/${qs ? `?${qs}` : ""}`);
  },
  createEvent: (data: Omit<Partial<EventData>, "line_items" | "additional_meals" | "guest_counts" | "timeline_entries"> & { dish_ids?: number[]; dish_comments?: EventDishComment[]; line_items?: unknown[]; additional_meals?: unknown[]; timeline_entries?: unknown[]; guest_counts?: { segment: string; count: number; price_per_head?: string | null }[] }) =>
    fetchApi<EventData>("/events/", {
      method: "POST",
      body: JSON.stringify(data),
    }),
  getEvent: (id: number) => fetchApi<EventData>(`/events/${id}/`),
  updateEvent: (id: number, data: Omit<Partial<EventData>, "line_items" | "additional_meals" | "guest_counts" | "timeline_entries"> & { dish_ids?: number[]; dish_comments?: EventDishComment[]; line_items?: unknown[]; additional_meals?: unknown[]; timeline_entries?: unknown[]; guest_counts?: { segment: string; count: number; price_per_head?: string | null }[] }) =>
    fetchApi<EventData>(`/events/${id}/`, {
      method: "PATCH",
      body: JSON.stringify(data),
    }),
  deleteEvent: (id: number) =>
    fetchApi<void>(`/events/${id}/`, { method: "DELETE" }),
  calculateEvent: (id: number) =>
    fetchApi<CalculationResult>(`/events/${id}/calculate/`, { method: "POST" }),
  /** Record final numbers (REL-419): guarantee + due date + per-entrée tallies in one
   * save. The only endpoint that checks the tallies add up to the guarantee. */
  recordEventFinals: (
    id: number,
    data: {
      final_count: number;
      final_count_due?: string | null;
      guaranteed_count?: number | null;
      choice_counts?: Record<string, number>;
    },
  ) =>
    fetchApi<EventData>(`/events/${id}/finals/`, {
      method: "POST",
      body: JSON.stringify(data),
    }),
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

  // Bookings: add-on catalog (priced products + variants)
  getAddOnProducts: () => fetchList<AddOnProduct>("/bookings/addon-products/?page_size=all"),

  // Bookings: Customers (people, person-first) — selectable independently of a business
  getContacts: () => fetchList<Contact>("/bookings/contacts/?page_size=all"),
  createCustomer: (data: Partial<Contact>) =>
    fetchApi<Contact>("/bookings/contacts/", { method: "POST", body: JSON.stringify(data) }),
  updateCustomer: (id: number, data: Partial<Contact>) =>
    fetchApi<Contact>(`/bookings/contacts/${id}/`, { method: "PATCH", body: JSON.stringify(data) }),

  // Bookings: Accounts (businesses)
  getAccounts: () => fetchList<Account>("/bookings/accounts/?page_size=all"),
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
  getVenues: () => fetchList<Venue>("/bookings/venues/?page_size=all"),
  getVenue: (id: number) => fetchApi<Venue>(`/bookings/venues/${id}/`),
  createVenue: (data: Partial<Venue>) =>
    fetchApi<Venue>("/bookings/venues/", { method: "POST", body: JSON.stringify(data) }),
  updateVenue: (id: number, data: Partial<Venue>) =>
    fetchApi<Venue>(`/bookings/venues/${id}/`, { method: "PATCH", body: JSON.stringify(data) }),

  // Bookings: Product Lines & Users
  getProductLines: () => fetchList<ProductLine>("/bookings/product-lines/?page_size=all"),
  updateProductLine: (id: number, data: Partial<ProductLine>) =>
    fetchApi<ProductLine>(`/bookings/product-lines/${id}/`, { method: "PATCH", body: JSON.stringify(data) }),
  // Management (manager/owner) — includes inactive lines; supports create/delete.
  getManagedProductLines: () => fetchList<ProductLine>("/bookings/settings/product-lines/?page_size=all"),
  createProductLine: (data: Partial<ProductLine>) =>
    fetchApi<ProductLine>("/bookings/settings/product-lines/", { method: "POST", body: JSON.stringify(data) }),
  updateManagedProductLine: (id: number, data: Partial<ProductLine>) =>
    fetchApi<ProductLine>(`/bookings/settings/product-lines/${id}/`, { method: "PATCH", body: JSON.stringify(data) }),
  deleteProductLine: (id: number) =>
    fetchApi<void>(`/bookings/settings/product-lines/${id}/`, { method: "DELETE" }),
  getUsers: () => fetchList<AuthUser>("/bookings/users/?page_size=all"),

  // User management (owner-only)
  getOrgUsers: () => fetchList<ManagedUser>("/auth/users/?page_size=all"),
  createUser: (data: { email: string; first_name: string; last_name: string; role: string; password: string; product_lines?: number[] }) =>
    fetchApi<ManagedUser>("/auth/users/", { method: "POST", body: JSON.stringify(data) }),
  updateUser: (id: number, data: Partial<ManagedUser & { password?: string }>) =>
    fetchApi<ManagedUser>(`/auth/users/${id}/`, { method: "PATCH", body: JSON.stringify(data) }),

  // Bookings: Leads
  getLeads: (filters?: LeadFilters) => {
    const params = new URLSearchParams();
    if (filters) {
      Object.entries(filters).forEach(([key, val]) => {
        if (val != null && val !== "") params.set(key, String(val));
      });
    }
    const qs = params.toString();
    return fetchList<Lead>(`/bookings/leads/${qs ? `?${qs}` : ""}`);
  },
  getLeadsPaginated: (filters?: LeadFilters) => {
    const params = new URLSearchParams();
    if (filters) {
      Object.entries(filters).forEach(([key, val]) => {
        if (val != null && val !== "") params.set(key, String(val));
      });
    }
    const qs = params.toString();
    return fetchApi<PaginatedResponse<Lead>>(`/bookings/leads/${qs ? `?${qs}` : ""}`);
  },
  getAllLeads: (filters?: LeadFilters) => {
    const params = new URLSearchParams({ page_size: "all" });
    if (filters) {
      Object.entries(filters).forEach(([key, val]) => {
        if (val) params.set(key, val);
      });
    }
    return fetchList<Lead>(`/bookings/leads/?${params.toString()}`);
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
    fetchList<ActivityLogEntry>(`/bookings/leads/${id}/activity/?page_size=all`),

  // Dashboard
  getDashboardStats: (period: string = "today", dateFrom?: string, dateTo?: string) => {
    const params = new URLSearchParams({ period });
    if (dateFrom) params.set("date_from", dateFrom);
    if (dateTo) params.set("date_to", dateTo);
    return fetchApi<DashboardStats>(`/bookings/dashboard/stats/?${params.toString()}`);
  },
  getMyDashboardStats: () => fetchApi<MyDashboardStats>("/bookings/dashboard/my-stats/"),
  getMyCommission: () => fetchApi<CommissionData>("/bookings/commission/me/"),
  getCommissionPlans: () => fetchList<CommissionPlanConfig>("/bookings/settings/commission-plans/?page_size=all"),
  createCommissionPlan: (data: { name: string; commission_model: string; commission_flat_rate: string }) =>
    fetchApi<CommissionPlanConfig>("/bookings/settings/commission-plans/", { method: "POST", body: JSON.stringify(data) }),
  updateCommissionPlan: (id: number, data: Partial<CommissionPlanConfig>) =>
    fetchApi<CommissionPlanConfig>(`/bookings/settings/commission-plans/${id}/`, { method: "PATCH", body: JSON.stringify(data) }),
  deleteCommissionPlan: (id: number) =>
    fetchApi<void>(`/bookings/settings/commission-plans/${id}/`, { method: "DELETE" }),
  getCommissionBands: () => fetchList<CommissionBandConfig>("/bookings/settings/commission-bands/?page_size=all"),
  createCommissionBand: (data: { plan: number; min_attainment_pct: string; rate: string }) =>
    fetchApi<CommissionBandConfig>("/bookings/settings/commission-bands/", { method: "POST", body: JSON.stringify(data) }),
  updateCommissionBand: (id: number, data: Partial<CommissionBandConfig>) =>
    fetchApi<CommissionBandConfig>(`/bookings/settings/commission-bands/${id}/`, { method: "PATCH", body: JSON.stringify(data) }),
  deleteCommissionBand: (id: number) =>
    fetchApi<void>(`/bookings/settings/commission-bands/${id}/`, { method: "DELETE" }),
  getSalesTargetGrid: (fiscalYear?: number) =>
    fetchApi<SalesTargetGrid>(`/bookings/settings/sales-targets/${fiscalYear ? `?fiscal_year=${fiscalYear}` : ""}`),
  setSalesTargetCell: (user: number, fiscal_year: number, period_index: number, amount: string) =>
    fetchApi<{ ok: boolean }>("/bookings/settings/sales-targets/", { method: "PUT", body: JSON.stringify({ user, fiscal_year, period_index, amount }) }),
  setRepPlan: (user: number, plan: number | null) =>
    fetchApi<{ ok: boolean }>("/bookings/settings/rep-plans/", { method: "PUT", body: JSON.stringify({ user, plan }) }),
  getLeadsKanban: (filters?: LeadFilters) => {
    const params = new URLSearchParams();
    if (filters) {
      Object.entries(filters).forEach(([key, val]) => {
        if (val != null && val !== "") params.set(key, String(val));
      });
    }
    const qs = params.toString();
    return fetchApi<KanbanResponse>(`/bookings/leads/kanban/${qs ? `?${qs}` : ""}`);
  },
  previewAutoAssign: () =>
    fetchApi<AutoAssignResult>("/bookings/leads/auto-assign/", {
      method: "POST",
      body: JSON.stringify({ dry_run: true }),
    }),
  autoAssignLeads: () =>
    fetchApi<AutoAssignResult>("/bookings/leads/auto-assign/", { method: "POST" }),

  // Bookings: Quotes
  getQuotes: (status?: string, pageSize?: number) => {
    const params = new URLSearchParams();
    if (status) params.set("status", status);
    if (pageSize) params.set("page_size", pageSize.toString());
    const qs = params.toString();
    return fetchList<Quote>(`/bookings/quotes/${qs ? `?${qs}` : ""}`);
  },
  getQuote: (id: number) => fetchApi<Quote>(`/bookings/quotes/${id}/`),
  createQuote: (data: Omit<Partial<Quote>, "line_items" | "additional_meals" | "guest_counts" | "timeline_entries"> & { dish_ids?: number[]; line_items?: unknown[]; additional_meals?: unknown[]; timeline_entries?: unknown[]; guest_counts?: { segment: string; count: number; price_per_head?: string | null }[] }) =>
    fetchApi<Quote>("/bookings/quotes/", { method: "POST", body: JSON.stringify(data) }),
  updateQuote: (id: number, data: Omit<Partial<Quote>, "line_items" | "additional_meals" | "guest_counts" | "timeline_entries"> & { dish_ids?: number[]; line_items?: unknown[]; additional_meals?: unknown[]; timeline_entries?: unknown[]; guest_counts?: { segment: string; count: number; price_per_head?: string | null }[] }) =>
    fetchApi<Quote>(`/bookings/quotes/${id}/`, { method: "PATCH", body: JSON.stringify(data) }),
  deleteQuote: (id: number) =>
    fetchApi<void>(`/bookings/quotes/${id}/`, { method: "DELETE" }),
  transitionQuote: (id: number, status: string) =>
    fetchApi<Quote>(`/bookings/quotes/${id}/transition/`, { method: "POST", body: JSON.stringify({ status }) }),

  // ── E-signature ──
  // Staff: mint the client sign link (and mark the quote SENT).
  sendQuoteForSignature: (id: number) =>
    fetchApi<{ public_token: string; status: string }>(
      `/bookings/quotes/${id}/send-for-signature/`, { method: "POST" }),
  sendEventForSignature: (id: number) =>
    fetchApi<{ public_token: string; status: string }>(
      `/events/${id}/send-for-signature/`, { method: "POST" }),
  // Public (unauthenticated): a plain fetch, deliberately outside fetchApi so a
  // client with no session never hits the 401-refresh/redirect path.
  getPublicBooking: async (token: string): Promise<PublicBooking> => {
    const res = await fetch(`${API_BASE}/public/bookings/${token}/`, { headers: { "Content-Type": "application/json" } });
    if (!res.ok) throw new Error(sanitizeError(res.status, await res.text()));
    return res.json();
  },
  signPublicBooking: async (token: string, payload: SignBookingPayload): Promise<PublicBooking> => {
    const res = await fetch(`${API_BASE}/public/bookings/${token}/sign/`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    if (!res.ok) throw new Error(sanitizeError(res.status, await res.text()));
    return res.json();
  },
  publicBookingPdfUrl: (token: string) => `${API_BASE}/public/bookings/${token}/pdf/`,
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
  downloadEventPDF: async (id: number): Promise<Blob> => {
    const res = await fetch(`${API_BASE}/events/${id}/pdf/`, {
      credentials: "include",
      headers: buildHeaders(),
    });
    if (!res.ok) {
      const text = await res.text();
      throw new Error(sanitizeError(res.status, text));
    }
    return res.blob();
  },
  // The day-of Banquet Event Order — the ops counterpart to the function sheet
  // above, carrying no pricing. Downloading NEVER moves the revision: printing a
  // second copy for the venue must not tell the kitchen its copy went stale. Use
  // `issueBEORevision` when something actually changed (REL-444).
  //
  // Returns the server's filename alongside the blob, because it is the only party
  // that knows which revision this download just became — the caller's copy of the
  // event is already one behind. Falls back to a plain name if Content-Disposition
  // isn't readable (it needs CORS_EXPOSE_HEADERS on a cross-origin API).
  downloadEventBEO: async (id: number): Promise<{ blob: Blob; filename: string }> => {
    const res = await fetch(`${API_BASE}/events/${id}/beo/`, {
      credentials: "include",
      headers: buildHeaders(),
    });
    if (!res.ok) {
      const text = await res.text();
      throw new Error(sanitizeError(res.status, text));
    }
    const disposition = res.headers.get("Content-Disposition") || "";
    const match = /filename="?([^";]+)"?/.exec(disposition);
    return { blob: await res.blob(), filename: match?.[1] || `BEO-${id}.pdf` };
  },
  // Bump the BEO to its next revision — a deliberate "this changed, everyone's copy
  // is stale" act, which is exactly why it isn't a side effect of downloading.
  issueBEORevision: (id: number) =>
    fetchApi<EventData>(`/events/${id}/beo/revise/`, { method: "POST" }),
  getQuoteLineItems: (quoteId: number) =>
    fetchList<QuoteLineItem>(`/bookings/quotes/${quoteId}/items/?page_size=all`),
  createQuoteLineItem: (quoteId: number, data: Partial<QuoteLineItem>) =>
    fetchApi<QuoteLineItem>(`/bookings/quotes/${quoteId}/items/`, { method: "POST", body: JSON.stringify(data) }),
  updateQuoteLineItem: (quoteId: number, itemId: number, data: Partial<QuoteLineItem>) =>
    fetchApi<QuoteLineItem>(`/bookings/quotes/${quoteId}/items/${itemId}/`, { method: "PATCH", body: JSON.stringify(data) }),
  deleteQuoteLineItem: (quoteId: number, itemId: number) =>
    fetchApi<void>(`/bookings/quotes/${quoteId}/items/${itemId}/`, { method: "DELETE" }),

  // Staff & Labor
  getLaborRoles: () => fetchList<LaborRole>("/staff/labor-roles/?page_size=all"),
  createLaborRole: (data: Partial<LaborRole>) =>
    fetchApi<LaborRole>("/staff/labor-roles/", { method: "POST", body: JSON.stringify(data) }),
  updateLaborRole: (id: number, data: Partial<LaborRole>) =>
    fetchApi<LaborRole>(`/staff/labor-roles/${id}/`, { method: "PATCH", body: JSON.stringify(data) }),
  deleteLaborRole: (id: number) =>
    fetchApi<void>(`/staff/labor-roles/${id}/`, { method: "DELETE" }),
  getStaff: () => fetchList<StaffMember>("/staff/members/?page_size=all"),
  getStaffMember: (id: number) => fetchApi<StaffMember>(`/staff/members/${id}/`),
  createStaffMember: (data: Partial<StaffMember>) =>
    fetchApi<StaffMember>("/staff/members/", { method: "POST", body: JSON.stringify(data) }),
  updateStaffMember: (id: number, data: Partial<StaffMember>) =>
    fetchApi<StaffMember>(`/staff/members/${id}/`, { method: "PATCH", body: JSON.stringify(data) }),

  // Shifts
  getShifts: (eventId?: number) =>
    fetchList<Shift>(`/staff/shifts/${eventId ? `?event=${eventId}` : ""}${eventId ? "&" : "?"}page_size=all`),
  createShift: (data: Partial<Shift>) =>
    fetchApi<Shift>("/staff/shifts/", { method: "POST", body: JSON.stringify(data) }),
  updateShift: (id: number, data: Partial<Shift>) =>
    fetchApi<Shift>(`/staff/shifts/${id}/`, { method: "PATCH", body: JSON.stringify(data) }),
  deleteShift: (id: number) =>
    fetchApi<void>(`/staff/shifts/${id}/`, { method: "DELETE" }),

  // Allocation Rules
  getAllocationRules: () => fetchList<AllocationRule>("/staff/allocation-rules/?page_size=all"),
  createAllocationRule: (data: Partial<AllocationRule>) =>
    fetchApi<AllocationRule>("/staff/allocation-rules/", { method: "POST", body: JSON.stringify(data) }),
  updateAllocationRule: (id: number, data: Partial<AllocationRule>) =>
    fetchApi<AllocationRule>(`/staff/allocation-rules/${id}/`, { method: "PATCH", body: JSON.stringify(data) }),
  deleteAllocationRule: (id: number) =>
    fetchApi<void>(`/staff/allocation-rules/${id}/`, { method: "DELETE" }),

  // Staff Reports
  getStaffReport: (params?: { date_from?: string; date_to?: string }) => {
    const searchParams = new URLSearchParams({ page_size: "all" });
    if (params?.date_from) searchParams.set("date_from", params.date_from);
    if (params?.date_to) searchParams.set("date_to", params.date_to);
    return fetchList<StaffReportEntry>(`/staff/reports/?${searchParams.toString()}`);
  },

  // Equipment
  getEquipment: () => fetchList<EquipmentItem>("/equipment/items/?page_size=all"),
  createEquipmentItem: (data: Partial<EquipmentItem>) =>
    fetchApi<EquipmentItem>("/equipment/items/", { method: "POST", body: JSON.stringify(data) }),
  updateEquipmentItem: (id: number, data: Partial<EquipmentItem>) =>
    fetchApi<EquipmentItem>(`/equipment/items/${id}/`, { method: "PATCH", body: JSON.stringify(data) }),

  // Equipment Reservations
  getReservations: (eventId?: number) =>
    fetchList<EquipmentReservation>(`/equipment/reservations/${eventId ? `?event=${eventId}` : ""}${eventId ? "&" : "?"}page_size=all`),
  createReservation: (data: Partial<EquipmentReservation>) =>
    fetchApi<EquipmentReservation>("/equipment/reservations/", { method: "POST", body: JSON.stringify(data) }),
  updateReservation: (id: number, data: Partial<EquipmentReservation>) =>
    fetchApi<EquipmentReservation>(`/equipment/reservations/${id}/`, { method: "PATCH", body: JSON.stringify(data) }),
  deleteReservation: (id: number) =>
    fetchApi<void>(`/equipment/reservations/${id}/`, { method: "DELETE" }),

  // Bookings: Invoices
  getInvoices: (params?: { event?: number; status?: string }) => {
    const searchParams = new URLSearchParams({ page_size: "all" });
    if (params?.event) searchParams.set("event", params.event.toString());
    if (params?.status) searchParams.set("status", params.status);
    return fetchList<Invoice>(`/bookings/invoices/?${searchParams.toString()}`);
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

  // Events: client payments (advances / part / full) recorded against a booking
  getEventPayments: (eventId: number) =>
    fetchList<EventPayment>(`/events/${eventId}/payments/?page_size=all`),
  createEventPayment: (eventId: number, data: Partial<EventPayment>) =>
    fetchApi<EventPayment>(`/events/${eventId}/payments/`, { method: "POST", body: JSON.stringify(data) }),
  deleteEventPayment: (eventId: number, paymentId: number) =>
    fetchApi<void>(`/events/${eventId}/payments/${paymentId}/`, { method: "DELETE" }),

  // Choice Options
  getEventTypes: () => fetchList<ChoiceOption>("/bookings/event-types/?page_size=all"),
  getServiceStyles: () => fetchList<ChoiceOption>("/bookings/service-styles/?page_size=all"),
  getSources: () => fetchList<ChoiceOption>("/bookings/sources/?page_size=all"),
  getLeadStatuses: () => fetchList<ChoiceOption>("/bookings/lead-statuses/?page_size=all"),
  // Management (manager/owner) — lists ALL statuses incl. inactive.
  getManagedLeadStatuses: () => fetchList<ChoiceOption>("/bookings/settings/lead-statuses/?page_size=all"),
  createLeadStatus: (data: Partial<ChoiceOption>) =>
    fetchApi<ChoiceOption>("/bookings/settings/lead-statuses/", { method: "POST", body: JSON.stringify(data) }),
  updateLeadStatus: (id: number, data: Partial<ChoiceOption>) =>
    fetchApi<ChoiceOption>(`/bookings/settings/lead-statuses/${id}/`, { method: "PATCH", body: JSON.stringify(data) }),
  deleteLeadStatus: (id: number) =>
    fetchApi<void>(`/bookings/settings/lead-statuses/${id}/`, { method: "DELETE" }),
  // Generic management for the simple choice-option lists (event types, sources,
  // service styles, meal types, lost reasons). `base` is the management endpoint,
  // e.g. "/bookings/settings/sources/".
  getManagedChoices: (base: string) => fetchList<ChoiceOption>(`${base}?page_size=all`),
  createChoiceOption: (base: string, data: Partial<ChoiceOption>) =>
    fetchApi<ChoiceOption>(base, { method: "POST", body: JSON.stringify(data) }),
  updateChoiceOption: (base: string, id: number, data: Partial<ChoiceOption>) =>
    fetchApi<ChoiceOption>(`${base}${id}/`, { method: "PATCH", body: JSON.stringify(data) }),
  deleteChoiceOption: (base: string, id: number) =>
    fetchApi<void>(`${base}${id}/`, { method: "DELETE" }),
  getLostReasons: () => fetchList<ChoiceOption>("/bookings/lost-reasons/?page_size=all"),
  getMealTypes: () => fetchList<ChoiceOption>("/bookings/meal-types/?page_size=all"),
  getTimelinePresets: () => fetchList<ChoiceOption>("/bookings/timeline-presets/?page_size=all"),

  // Settings
  getSiteSettings: () => fetchApi<SiteSettingsData>("/bookings/settings/"),
  updateSiteSettings: (data: Partial<SiteSettingsData>) =>
    fetchApi<SiteSettingsData>("/bookings/settings/", { method: "PATCH", body: JSON.stringify(data) }),

  // Reminders
  getReminders: (params?: { status?: string; due_before?: string; due_after?: string; lead?: number; user?: string }) => {
    const searchParams = new URLSearchParams({ page_size: "all" });
    if (params?.status) searchParams.set("status", params.status);
    if (params?.due_before) searchParams.set("due_before", params.due_before);
    if (params?.due_after) searchParams.set("due_after", params.due_after);
    if (params?.lead) searchParams.set("lead", params.lead.toString());
    if (params?.user) searchParams.set("user", params.user);
    return fetchList<Reminder>(`/bookings/reminders/?${searchParams.toString()}`);
  },
  getReminderCounts: () => fetchApi<ReminderCounts>("/bookings/reminders/counts/"),
  getLeadReminders: (leadId: number) =>
    fetchList<Reminder>(`/bookings/leads/${leadId}/reminders/?page_size=all`),
  createReminder: (leadId: number, data: Partial<Reminder>) =>
    fetchApi<Reminder>(`/bookings/leads/${leadId}/reminders/`, { method: "POST", body: JSON.stringify(data) }),
  updateReminder: (id: number, data: Partial<Reminder>) =>
    fetchApi<Reminder>(`/bookings/reminders/${id}/`, { method: "PATCH", body: JSON.stringify(data) }),
  deleteReminder: (id: number) =>
    fetchApi<void>(`/bookings/reminders/${id}/`, { method: "DELETE" }),

  // WhatsApp
  getLeadWhatsAppMessages: (leadId: number) =>
    fetchApi<WhatsAppMessage[]>(`/bookings/leads/${leadId}/whatsapp/`),
  sendWhatsAppMessage: (leadId: number, data: { body?: string; template?: string; template_context?: Record<string, string> }) =>
    fetchApi<WhatsAppMessage>(`/bookings/leads/${leadId}/whatsapp/send/`, { method: "POST", body: JSON.stringify(data) }),
  markWhatsAppRead: (leadId: number) =>
    fetchApi<{ marked_read: number }>(`/bookings/leads/${leadId}/whatsapp/mark-read/`, { method: "POST" }),

  // Client messaging (REL-445). One shape for quotes, events and leads — the
  // parent only changes the path, never the payload.
  draftClientMessage: (
    parent: ClientMessageParent, id: number,
    data: { kind: ClientMessageKind; channel?: ClientChannel; attach?: boolean },
  ) =>
    fetchApi<ClientMessageDraft>(`${clientMessageBase(parent, id)}/draft-message/`, {
      method: "POST",
      body: JSON.stringify(data),
    }),
  sendClientMessage: (
    parent: ClientMessageParent, id: number,
    data: { kind: ClientMessageKind; channel: ClientChannel; subject?: string; body: string; attach?: boolean },
  ) =>
    fetchApi<WhatsAppMessage>(`${clientMessageBase(parent, id)}/send-message/`, {
      method: "POST",
      body: JSON.stringify(data),
    }),
  getClientMessages: (parent: "quote" | "event", id: number) =>
    fetchApi<WhatsAppMessage[]>(`${clientMessageBase(parent, id)}/messages/`),
  getMessagingStatus: (parent: ClientMessageParent, id: number) =>
    fetchApi<ChannelAvailability>(`${clientMessageBase(parent, id)}/messaging-status/`),

  // Client email — the caterer's own connected mailbox
  getConnectedMailbox: () =>
    fetchApi<MailboxStatus>("/integrations/email/"),
  // Returns the provider consent URL; the browser has to navigate to it, and
  // the provider then redirects back to /settings?tab=integrations.
  startMailboxConnect: (provider: MailboxProvider) =>
    fetchApi<{ auth_url: string }>(`/integrations/email/connect/?provider=${provider}`),
  disconnectMailbox: () =>
    fetchApi<void>("/integrations/email/disconnect/", { method: "POST" }),

  // AI follow-up drafts
  getFollowUpDrafts: (status: string = "pending") =>
    fetchList<FollowUpDraft>(`/bookings/followup-drafts/?page_size=all&status=${status}`),
  getLeadFollowUpDrafts: (leadId: number) =>
    fetchList<FollowUpDraft>(`/bookings/leads/${leadId}/followup-drafts/?page_size=all`),
  getFollowUpDraftCount: () =>
    fetchApi<{ pending: number }>(`/bookings/followup-drafts/count/`),
  getFollowUpStats: (period: string = "all", dateFrom?: string, dateTo?: string) => {
    const params = new URLSearchParams({ period });
    if (dateFrom) params.set("date_from", dateFrom);
    if (dateTo) params.set("date_to", dateTo);
    return fetchApi<FollowUpStats>(`/bookings/followup-drafts/stats/?${params.toString()}`);
  },
  approveFollowUpDraft: (id: number, body?: string) =>
    fetchApi<FollowUpDraft>(`/bookings/followup-drafts/${id}/approve/`, {
      method: "POST",
      body: JSON.stringify(body !== undefined ? { body } : {}),
    }),
  dismissFollowUpDraft: (id: number) =>
    fetchApi<FollowUpDraft>(`/bookings/followup-drafts/${id}/dismiss/`, { method: "POST" }),
  markFollowUpSent: (id: number, body?: string) =>
    fetchApi<FollowUpDraft>(`/bookings/followup-drafts/${id}/mark-sent/`, {
      method: "POST",
      body: JSON.stringify(body != null ? { body } : {}),
    }),
  logLeadReply: (leadId: number) =>
    fetchApi<{ logged: boolean }>(`/bookings/leads/${leadId}/log-reply/`, { method: "POST" }),
  markQuoteSharedWhatsApp: (id: number, body?: string) =>
    fetchApi<Quote>(`/bookings/quotes/${id}/mark-shared-whatsapp/`, {
      method: "POST",
      body: JSON.stringify(body != null ? { body } : {}),
    }),
  getFollowUpPreview: () =>
    fetchApi<FollowUpPreview>(`/bookings/followup-drafts/preview/`),
  generateFollowUpDraft: (leadId: number) =>
    fetchApi<FollowUpGenerateResult>(`/bookings/followup-drafts/generate/`, {
      method: "POST",
      body: JSON.stringify({ lead: leadId }),
    }),
  bulkApproveFollowUpDrafts: (ids?: number[]) =>
    fetchApi<{ sent: number[]; failed: { id: number; error: string }[] }>(
      `/bookings/followup-drafts/bulk-approve/`,
      { method: "POST", body: JSON.stringify(ids ? { ids } : {}) },
    ),

  // Calendar
  getEventCalendar: (month: string, status?: string, product?: string) => {
    const params = new URLSearchParams({ month });
    if (status) params.set("status", status);
    if (product) params.set("product", product);
    return fetchApi<CalendarDay[]>(`/events/calendar/?${params.toString()}`);
  },

  // Locked Dates
  getLockedDates: (dateFrom: string, dateTo: string) =>
    fetchList<LockedDate>(`/bookings/locked-dates/?date_from=${dateFrom}&date_to=${dateTo}`),
  lockDate: (data: { date: string; reason?: string }) =>
    fetchApi<LockedDate>("/bookings/locked-dates/", { method: "POST", body: JSON.stringify(data) }),
  unlockDate: (id: number) =>
    fetchApi<void>(`/bookings/locked-dates/${id}/`, { method: "DELETE" }),
};
