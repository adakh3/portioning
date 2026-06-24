import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";

const mutate = vi.fn();
vi.mock("@/lib/hooks", () => ({
  useManagedProductLines: () => ({
    data: [
      { id: 1, name: "Weddings", colour: "#3B82F6", is_active: true },
      { id: 2, name: "Corporate", colour: "#10B981", is_active: true },
    ],
    mutate,
    isLoading: false,
  }),
  revalidate: vi.fn(),
}));

const createProductLine = vi.fn().mockResolvedValue({});
const updateManagedProductLine = vi.fn().mockResolvedValue({});
const deleteProductLine = vi.fn().mockResolvedValue(undefined);
vi.mock("@/lib/api", () => ({
  api: {
    createProductLine: (...a: unknown[]) => createProductLine(...a),
    updateManagedProductLine: (...a: unknown[]) => updateManagedProductLine(...a),
    deleteProductLine: (...a: unknown[]) => deleteProductLine(...a),
  },
}));

import ProductLinesSettings from "./ProductLinesSettings";

describe("ProductLinesSettings", () => {
  beforeEach(() => { createProductLine.mockClear(); updateManagedProductLine.mockClear(); });

  it("lists existing product lines", () => {
    render(<ProductLinesSettings />);
    expect(screen.getByDisplayValue("Weddings")).toBeTruthy();
    expect(screen.getByDisplayValue("Corporate")).toBeTruthy();
  });

  it("adds a new product line", async () => {
    render(<ProductLinesSettings />);
    fireEvent.change(screen.getByPlaceholderText(/New product line/i), { target: { value: "Mehndi" } });
    fireEvent.click(screen.getByText("+ Add product line"));
    await waitFor(() => expect(createProductLine).toHaveBeenCalled());
    expect(createProductLine.mock.calls[0][0]).toMatchObject({ name: "Mehndi" });
  });

  it("renames on blur", async () => {
    render(<ProductLinesSettings />);
    const input = screen.getByDisplayValue("Corporate");
    fireEvent.change(input, { target: { value: "Corporate Events" } });
    fireEvent.blur(input);
    await waitFor(() => expect(updateManagedProductLine).toHaveBeenCalledWith(2, { name: "Corporate Events" }));
  });
});
