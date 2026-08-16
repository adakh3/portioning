import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";

const push = vi.fn();
let routeId = "new";
vi.mock("next/navigation", () => ({
  useParams: () => ({ id: routeId }),
  useRouter: () => ({ push }),
}));
vi.mock("@/lib/auth", () => ({ useAuth: () => ({ user: { id: 1, role: "owner" } }) }));

const catalog = [
  { id: 10, name: "Grilled Chicken", category_name: "Entrées", is_active: true },
  { id: 11, name: "Chocolate Cake", category_name: "Desserts", is_active: true },
];
const revalidate = vi.fn();
vi.mock("@/lib/hooks", () => ({
  useDishes: () => ({ data: catalog }),
  revalidate: (...a: unknown[]) => revalidate(...a),
}));

const createMenu = vi.fn().mockResolvedValue({ id: 5 });
const updateMenu = vi.fn().mockResolvedValue({});
const deleteMenu = vi.fn().mockResolvedValue(undefined);
const getManagedMenu = vi.fn();
vi.mock("@/lib/api", () => ({
  api: {
    createMenu: (...a: unknown[]) => createMenu(...a),
    updateMenu: (...a: unknown[]) => updateMenu(...a),
    deleteMenu: (...a: unknown[]) => deleteMenu(...a),
    getManagedMenu: (...a: unknown[]) => getManagedMenu(...a),
  },
}));

import MenuEditorPage from "./page";

describe("MenuEditorPage (new)", () => {
  beforeEach(() => {
    routeId = "new";
    createMenu.mockClear(); updateMenu.mockClear(); push.mockClear(); revalidate.mockClear();
  });

  it("composes a menu — name, a course, a dish assigned to it — and posts the compose-only payload", async () => {
    render(<MenuEditorPage />);

    fireEvent.change(screen.getByLabelText("Menu name"), { target: { value: "Wedding Menu" } });
    fireEvent.change(screen.getByLabelText("Menu type"), { target: { value: "barat" } });

    // A course.
    fireEvent.click(screen.getByText("+ Add course"));
    fireEvent.change(screen.getByLabelText("Course 1 name"), { target: { value: "Mains" } });

    // Add a dish from the catalog, then assign it to the course.
    fireEvent.click(screen.getByLabelText("Add Grilled Chicken"));
    fireEvent.change(screen.getByLabelText("Course for Grilled Chicken"), { target: { value: "0" } });

    // A price tier.
    fireEvent.click(screen.getByText("+ Add tier"));
    fireEvent.change(screen.getByLabelText("Tier 1 minimum guests"), { target: { value: "50" } });
    fireEvent.change(screen.getByLabelText("Tier 1 price per head"), { target: { value: "45.00" } });

    fireEvent.click(screen.getByText("Create menu"));

    await waitFor(() => expect(createMenu).toHaveBeenCalled());
    const payload = createMenu.mock.calls[0][0];
    expect(payload).toMatchObject({
      name: "Wedding Menu",
      menu_type: "barat",
      courses: [{ name: "Mains", sort_order: 0 }],
      dishes: [{ dish_id: 10, course: 0 }],
      price_tiers: [{ min_guests: 50, price_per_head: "45.00" }],
    });
    // portion_grams is never sent (auto-computed on the backend).
    expect(payload.dishes[0]).not.toHaveProperty("portion_grams");
    await waitFor(() => expect(push).toHaveBeenCalledWith("/menus"));
  });

  it("removing a course unassigns dishes that were in it", async () => {
    render(<MenuEditorPage />);
    fireEvent.change(screen.getByLabelText("Menu name"), { target: { value: "M" } });
    fireEvent.click(screen.getByText("+ Add course"));
    fireEvent.click(screen.getByLabelText("Add Chocolate Cake"));
    fireEvent.change(screen.getByLabelText("Course for Chocolate Cake"), { target: { value: "0" } });
    // Remove the only course — the dish's course ref must fall back to null.
    fireEvent.click(screen.getByLabelText("Remove course 1"));
    fireEvent.click(screen.getByText("Create menu"));
    await waitFor(() => expect(createMenu).toHaveBeenCalled());
    const payload = createMenu.mock.calls[0][0];
    expect(payload.courses).toEqual([]);
    expect(payload.dishes).toEqual([{ dish_id: 11, course: null }]);
  });

  it("requires a name before saving", async () => {
    render(<MenuEditorPage />);
    fireEvent.click(screen.getByText("Create menu"));
    expect(screen.getByRole("alert").textContent).toMatch(/name/i);
    expect(createMenu).not.toHaveBeenCalled();
  });
});

describe("MenuEditorPage (existing)", () => {
  beforeEach(() => {
    routeId = "7";
    updateMenu.mockClear(); push.mockClear();
    getManagedMenu.mockResolvedValue({
      id: 7, name: "Existing", description: "", menu_type: "custom",
      default_gents: 60, default_ladies: 40, is_active: true,
      courses: [{ name: "Starters", sort_order: 0 }],
      dishes: [{ dish_id: 10, dish_name: "Grilled Chicken", category_name: "Entrées", portion_grams: 180, course: 0 }],
      price_tiers: [],
    });
  });

  it("loads the template and updates it on save", async () => {
    render(<MenuEditorPage />);
    // Loaded values appear.
    await waitFor(() => expect(screen.getByLabelText("Menu name")).toHaveProperty("value", "Existing"));
    expect(screen.getByLabelText("Course 1 name")).toHaveProperty("value", "Starters");
    // The pre-loaded dish shows with its course selected.
    expect(screen.getByText("Grilled Chicken")).toBeTruthy();

    fireEvent.change(screen.getByLabelText("Menu name"), { target: { value: "Renamed" } });
    fireEvent.click(screen.getByText("Save changes"));
    await waitFor(() => expect(updateMenu).toHaveBeenCalledWith(7, expect.objectContaining({ name: "Renamed" })));
    await waitFor(() => expect(push).toHaveBeenCalledWith("/menus"));
  });
});
