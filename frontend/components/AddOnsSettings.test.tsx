import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";

const mutate = vi.fn();
const revalidate = vi.fn();
// Two products: one simple (no variants), one with variants (a priced override + an inherited one).
let data: unknown[];
vi.mock("@/lib/hooks", () => ({
  useManagedAddOnProducts: () => ({ data, mutate, isLoading: false }),
  useSiteSettings: () => ({ data: { currency_symbol: "$" } }),
  revalidate: (...a: unknown[]) => revalidate(...a),
}));

const createAddOnProduct = vi.fn().mockResolvedValue({ id: 99 });
const updateAddOnProduct = vi.fn().mockResolvedValue({});
const deleteAddOnProduct = vi.fn().mockResolvedValue(undefined);
vi.mock("@/lib/api", () => ({
  api: {
    createAddOnProduct: (...a: unknown[]) => createAddOnProduct(...a),
    updateAddOnProduct: (...a: unknown[]) => updateAddOnProduct(...a),
    deleteAddOnProduct: (...a: unknown[]) => deleteAddOnProduct(...a),
  },
}));

import AddOnsSettings from "./AddOnsSettings";

function resetData() {
  data = [
    {
      id: 1, name: "Chair rental", category: "rental", default_unit: "each",
      unit_price: "5.00", is_taxable: true, is_featured: false, is_active: true,
      sort_order: 0, variants: [],
    },
    {
      id: 2, name: "Mocktails", category: "beverage", default_unit: "each",
      unit_price: "4.00", is_taxable: true, is_featured: false, is_active: true,
      sort_order: 1,
      variants: [
        { id: 10, name: "Mojito", unit_price: "3.00", is_active: true, sort_order: 0 },
        { id: 11, name: "Virgin Mary", unit_price: null, is_active: true, sort_order: 1 },
      ],
    },
  ];
}

/** Open the editor for a product by clicking its name (compact rows are read-only). */
function openEditor(name: string) {
  fireEvent.click(screen.getByRole("button", { name }));
}

describe("AddOnsSettings", () => {
  beforeEach(() => {
    resetData();
    createAddOnProduct.mockClear();
    updateAddOnProduct.mockClear();
    deleteAddOnProduct.mockClear();
    revalidate.mockClear();
  });

  it("lists products compactly (names as text, not inputs, by default)", () => {
    render(<AddOnsSettings />);
    expect(screen.getByRole("button", { name: "Chair rental" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Mocktails" })).toBeTruthy();
    // Compact rows are read-only — no editable name field until the row is edited.
    expect(screen.queryByLabelText("Chair rental name")).toBeNull();
    // A sortable column header is present.
    expect(screen.getByRole("button", { name: "Sort by Price" })).toBeTruthy();
  });

  it("creates a product with sensible defaults", async () => {
    render(<AddOnsSettings />);
    fireEvent.change(screen.getByPlaceholderText(/New add-on/i), { target: { value: "Linens" } });
    fireEvent.click(screen.getByText("+ Add add-on"));
    await waitFor(() => expect(createAddOnProduct).toHaveBeenCalled());
    expect(createAddOnProduct.mock.calls[0][0]).toMatchObject({
      name: "Linens", category: "rental", default_unit: "each", unit_price: "0",
    });
  });

  it("expands a row into the editor and renames on blur with its id", async () => {
    render(<AddOnsSettings />);
    openEditor("Chair rental");
    const input = screen.getByLabelText("Chair rental name");
    fireEvent.change(input, { target: { value: "Folding chair" } });
    fireEvent.blur(input);
    await waitFor(() =>
      expect(updateAddOnProduct).toHaveBeenCalledWith(1, { name: "Folding chair" }));
  });

  it("toggles featured from within the editor", async () => {
    render(<AddOnsSettings />);
    openEditor("Chair rental");
    fireEvent.click(screen.getByText("Feature"));
    await waitFor(() =>
      expect(updateAddOnProduct).toHaveBeenCalledWith(1, { is_featured: true }));
  });

  it("changes the category via the editor select", async () => {
    render(<AddOnsSettings />);
    openEditor("Chair rental");
    fireEvent.change(screen.getByLabelText("Chair rental category"), { target: { value: "fee" } });
    await waitFor(() =>
      expect(updateAddOnProduct).toHaveBeenCalledWith(1, { category: "fee" }));
  });

  it("adds a variant by sending the whole variants array (existing rows preserved)", async () => {
    render(<AddOnsSettings />);
    openEditor("Mocktails");
    fireEvent.click(screen.getByText("+ Add variant"));
    await waitFor(() => expect(updateAddOnProduct).toHaveBeenCalled());
    const [id, payload] = updateAddOnProduct.mock.calls[0] as [number, { variants: unknown[] }];
    expect(id).toBe(2);
    expect(payload.variants).toHaveLength(3);
    expect(payload.variants[0]).toMatchObject({ id: 10, name: "Mojito" });
    expect(payload.variants[2]).toMatchObject({ name: "", unit_price: null });
  });

  it("clears a variant price to null (inherit) on blur", async () => {
    render(<AddOnsSettings />);
    openEditor("Mocktails");
    const mojitoPrice = screen.getByDisplayValue("3.00");
    fireEvent.change(mojitoPrice, { target: { value: "" } });
    fireEvent.blur(mojitoPrice);
    await waitFor(() => expect(updateAddOnProduct).toHaveBeenCalled());
    const payload = updateAddOnProduct.mock.calls[0][1] as { variants: Array<{ id: number; unit_price: string | null }> };
    const mojito = payload.variants.find((v) => v.id === 10)!;
    expect(mojito.unit_price).toBeNull();
  });

  it("sorts by a column when its header is clicked, and reverses on a second click", () => {
    render(<AddOnsSettings />);
    const names = () => screen.getAllByTestId("addon-row-name").map((n) => n.textContent);
    // Default = server order: Chair rental (sort_order 0) then Mocktails.
    expect(names()).toEqual(["Chair rental", "Mocktails"]);
    // Sort by price ascending: Mocktails (4.00) before Chair rental (5.00).
    fireEvent.click(screen.getByRole("button", { name: "Sort by Price" }));
    expect(names()).toEqual(["Mocktails", "Chair rental"]);
    // Second click reverses to descending.
    fireEvent.click(screen.getByRole("button", { name: "Sort by Price" }));
    expect(names()).toEqual(["Chair rental", "Mocktails"]);
  });

  it("deletes a product from the compact row and refreshes the quote/event pickers", async () => {
    render(<AddOnsSettings />);
    // The compact row's delete button (no editor open).
    fireEvent.click(screen.getByLabelText("Delete Chair rental"));
    await waitFor(() => expect(deleteAddOnProduct).toHaveBeenCalledWith(1));
    await waitFor(() => expect(revalidate).toHaveBeenCalledWith("addon-products"));
  });
});
