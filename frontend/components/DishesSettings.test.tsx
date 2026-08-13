import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";

const mutate = vi.fn();
const revalidate = vi.fn();
let dishes: unknown[];
const categories = [
  { id: 1, display_name: "Entrées" },
  { id: 2, display_name: "Desserts" },
];
const tags = [
  { id: 10, slug: "vegetarian", label: "Vegetarian", short_label: "V", kind: "dietary" },
  { id: 11, slug: "nuts", label: "Contains nuts", short_label: "N", kind: "allergen" },
];
vi.mock("@/lib/hooks", () => ({
  useManagedDishes: () => ({ data: dishes, mutate, isLoading: false }),
  useCategories: () => ({ data: categories }),
  useDietaryTags: () => ({ data: tags }),
  useSiteSettings: () => ({ data: { currency_symbol: "$" } }),
  revalidate: (...a: unknown[]) => revalidate(...a),
}));

const createDish = vi.fn().mockResolvedValue({ id: 99 });
const updateDish = vi.fn().mockResolvedValue({});
const deleteDish = vi.fn();
vi.mock("@/lib/api", () => ({
  api: {
    createDish: (...a: unknown[]) => createDish(...a),
    updateDish: (...a: unknown[]) => updateDish(...a),
    deleteDish: (...a: unknown[]) => deleteDish(...a),
  },
}));

import DishesSettings from "./DishesSettings";

function resetData() {
  dishes = [
    {
      id: 1, name: "Grilled Chicken", category: 1, category_name: "Entrées",
      cost_per_gram: 0.012, selling_price_per_gram: "0.04", addition_surcharge: "7.20",
      is_active: true, dietary_tags: [], notes: "",
    },
    {
      id: 2, name: "Chocolate Cake", category: 2, category_name: "Desserts",
      cost_per_gram: 0.02, selling_price_per_gram: "0.06", addition_surcharge: "5.40",
      is_active: true, dietary_tags: [{ id: 10, slug: "vegetarian", label: "Vegetarian", short_label: "V", kind: "dietary" }], notes: "",
    },
  ];
}

const openEditor = (name: string) => fireEvent.click(screen.getByRole("button", { name }));

describe("DishesSettings", () => {
  beforeEach(() => {
    resetData();
    createDish.mockClear();
    updateDish.mockClear();
    deleteDish.mockReset();
    deleteDish.mockResolvedValue(undefined);
    revalidate.mockClear();
  });

  it("lists dishes compactly (read-only rows until edited)", () => {
    render(<DishesSettings />);
    expect(screen.getByRole("button", { name: "Grilled Chicken" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Chocolate Cake" })).toBeTruthy();
    expect(screen.queryByLabelText("Grilled Chicken name")).toBeNull();
  });

  it("creates a dish under the visible category with a zero cost default", async () => {
    render(<DishesSettings />);
    fireEvent.change(screen.getByPlaceholderText(/New dish/i), { target: { value: "Lamb Curry" } });
    fireEvent.click(screen.getByText("+ Add dish"));
    await waitFor(() => expect(createDish).toHaveBeenCalled());
    expect(createDish.mock.calls[0][0]).toMatchObject({ name: "Lamb Curry", category: 1, cost_per_gram: 0 });
  });

  it("renames a dish on blur with its id (from the editor)", async () => {
    render(<DishesSettings />);
    openEditor("Grilled Chicken");
    const input = screen.getByLabelText("Grilled Chicken name");
    fireEvent.change(input, { target: { value: "Roast Chicken" } });
    fireEvent.blur(input);
    await waitFor(() => expect(updateDish).toHaveBeenCalledWith(1, { name: "Roast Chicken" }));
  });

  it("changes the category via the editor select", async () => {
    render(<DishesSettings />);
    openEditor("Grilled Chicken");
    fireEvent.change(screen.getByLabelText("Grilled Chicken category"), { target: { value: "2" } });
    await waitFor(() => expect(updateDish).toHaveBeenCalledWith(1, { category: 2 }));
  });

  it("toggles a dietary tag by sending the new id set", async () => {
    render(<DishesSettings />);
    openEditor("Grilled Chicken");
    fireEvent.click(screen.getByLabelText("Add Vegetarian"));
    await waitFor(() => expect(updateDish).toHaveBeenCalledWith(1, { dietary_tag_ids: [10] }));
  });

  it("filters by search and by category", () => {
    render(<DishesSettings />);
    fireEvent.change(screen.getByPlaceholderText(/Search dishes/i), { target: { value: "cake" } });
    expect(screen.queryByRole("button", { name: "Grilled Chicken" })).toBeNull();
    expect(screen.getByRole("button", { name: "Chocolate Cake" })).toBeTruthy();

    fireEvent.change(screen.getByPlaceholderText(/Search dishes/i), { target: { value: "" } });
    fireEvent.change(screen.getByLabelText("Filter by category"), { target: { value: "1" } });
    expect(screen.getByRole("button", { name: "Grilled Chicken" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Chocolate Cake" })).toBeNull();
  });

  it("sorts by cost when the header is clicked", () => {
    render(<DishesSettings />);
    const names = () => screen.getAllByTestId("dish-row-name").map((n) => n.textContent);
    fireEvent.click(screen.getByRole("button", { name: "Sort by Cost/g" }));
    // Chicken 0.012 before Cake 0.02 ascending.
    expect(names()).toEqual(["Grilled Chicken", "Chocolate Cake"]);
    fireEvent.click(screen.getByRole("button", { name: "Sort by Cost/g" }));
    expect(names()).toEqual(["Chocolate Cake", "Grilled Chicken"]);
  });

  it("surfaces the backend guard message when a delete is rejected", async () => {
    deleteDish.mockRejectedValueOnce(new Error('"Grilled Chicken" is on 1 quote(s) and cannot be deleted — untick "is active" instead'));
    render(<DishesSettings />);
    fireEvent.click(screen.getByLabelText("Delete Grilled Chicken"));
    await waitFor(() => expect(screen.getByRole("alert").textContent).toMatch(/cannot be deleted/i));
  });

  it("deletes a dish and refreshes dish-dependent caches", async () => {
    render(<DishesSettings />);
    fireEvent.click(screen.getByLabelText("Delete Chocolate Cake"));
    await waitFor(() => expect(deleteDish).toHaveBeenCalledWith(2));
    await waitFor(() => expect(revalidate).toHaveBeenCalledWith("dishes", "menus"));
  });
});
