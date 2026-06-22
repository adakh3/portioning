import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { useState } from "react";

vi.mock("@/lib/hooks", () => ({
  useAddOnProducts: () => ({
    data: [
      {
        id: 1, name: "Mocktails", category: "beverage", default_unit: "each",
        is_taxable: true, is_featured: true, is_active: true, sort_order: 0,
        variants: [
          { id: 11, name: "Mojito", unit_price: "3.00", is_active: true, sort_order: 0 },
          { id: 12, name: "Virgin Colada", unit_price: "3.50", is_active: true, sort_order: 1 },
        ],
      },
      // Featured product with a base price and NO variant — shows and prefills its price.
      {
        id: 2, name: "Sound System", category: "rental", default_unit: "flat",
        unit_price: "15000.00",
        is_taxable: true, is_featured: true, is_active: true, sort_order: 1,
        variants: [],
      },
    ],
  }),
}));

import AddOnItemsEditor from "./AddOnItemsEditor";
import { LineItemInput } from "@/lib/quoteTotals";

function Harness() {
  const [items, setItems] = useState<LineItemInput[]>([]);
  return (
    <>
      <AddOnItemsEditor items={items} onChange={setItems} guestCount={100} currencySymbol="£" />
      <div data-testid="count">{items.length}</div>
      <div data-testid="json">{JSON.stringify(items)}</div>
    </>
  );
}

describe("AddOnItemsEditor", () => {
  it("ticks a featured variant to add a priced line, prefilled from the catalog", () => {
    render(<Harness />);
    fireEvent.click(screen.getByLabelText(/Mojito/));
    expect(screen.getByTestId("count").textContent).toBe("1");
    const items = JSON.parse(screen.getByTestId("json").textContent!);
    expect(items[0]).toMatchObject({ variant: 11, unit_price: "3.00", category: "beverage", description: "Mocktails — Mojito" });
  });

  it("supports multiple variants and an ad-hoc custom row", () => {
    render(<Harness />);
    fireEvent.click(screen.getByLabelText(/Mojito/));
    fireEvent.click(screen.getByLabelText(/Virgin Colada/));
    fireEvent.click(screen.getByText("+ Custom item"));
    expect(screen.getByTestId("count").textContent).toBe("3");
    const items = JSON.parse(screen.getByTestId("json").textContent!);
    expect(items.filter((i: LineItemInput) => i.variant).length).toBe(2);
    expect(items.filter((i: LineItemInput) => !i.variant).length).toBe(1); // custom
  });

  it("shows a featured product with no variant and prefills its base price", () => {
    render(<Harness />);
    fireEvent.click(screen.getByLabelText("Sound System"));
    expect(screen.getByTestId("count").textContent).toBe("1");
    const items = JSON.parse(screen.getByTestId("json").textContent!);
    expect(items[0]).toMatchObject({ variant: null, category: "rental", description: "Sound System", unit_price: "15000.00" });
  });
});
