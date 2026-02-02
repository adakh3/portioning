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
  constraint_override?: {
    max_total_food_per_person_grams?: number;
    min_portion_per_dish_grams?: number;
  };
  created_at: string;
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
  getEvents: () => fetchApi<EventData[]>("/events/"),
  createEvent: (data: Partial<EventData> & { dish_ids?: number[] }) =>
    fetchApi<EventData>("/events/", {
      method: "POST",
      body: JSON.stringify(data),
    }),
  getEvent: (id: number) => fetchApi<EventData>(`/events/${id}/`),
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
};
