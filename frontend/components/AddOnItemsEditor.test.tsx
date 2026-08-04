import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent, within } from "@testing-library/react";
import { useState } from "react";

// The add-ons card is now a list of the lines ON this booking plus a searchable
// catalogue picker (REL-454). These cover the acceptance criteria for the card and
// the picker; the payload that reaches api.create*/update* is pinned by the
// page-level tests (page.addons.test.tsx on quotes and events), and save+reload by
// the Playwright spec.
//
// The fixture deliberately carries all four product shapes: no variants, one
// variant, several variants, and a NON-featured product (the flag is inert now).
vi.mock("@/lib/hooks", () => ({
  useAddOnProducts: () => ({
    data: [
      {
        id: 1, name: "Soft Drinks", category: "beverage", default_unit: "each",
        unit_price: "0.00", is_taxable: true, is_featured: true, is_active: true, sort_order: 0,
        variants: [
          { id: 11, name: "1.5L", unit_price: "150.00", is_active: true, sort_order: 0 },
          { id: 12, name: "Tins", unit_price: "80.00", is_active: true, sort_order: 1 },
        ],
      },
      {
        id: 2, name: "Milkshake", category: "beverage", default_unit: "each",
        unit_price: "300.00", is_taxable: true, is_featured: true, is_active: true, sort_order: 1,
        variants: [],
      },
      {
        id: 3, name: "Coffee & Tea Service", category: "beverage", default_unit: "per_guest",
        unit_price: "6.00", is_taxable: true, is_featured: true, is_active: true, sort_order: 2,
        variants: [],
      },
      {
        id: 4, name: "Delivery & Setup", category: "fee", default_unit: "flat",
        unit_price: "450.00", is_taxable: true, is_featured: true, is_active: true, sort_order: 3,
        variants: [],
      },
      {
        id: 5, name: "Server / Waitstaff", category: "labor", default_unit: "each",
        unit_price: "220.00", is_taxable: true, is_featured: true, is_active: true, sort_order: 4,
        variants: [],
      },
      // Straight out of the starter catalogue: NOT featured. It must appear in the
      // picker exactly like the rest (AC17) — the flag no longer drives the UI.
      {
        id: 6, name: "Table Linens", category: "rental", default_unit: "each",
        unit_price: "25.00", is_taxable: true, is_featured: false, is_active: true, sort_order: 5,
        variants: [],
      },
    ],
  }),
}));

import AddOnItemsEditor from "./AddOnItemsEditor";
import { LineItemInput, computeBookingTotals } from "@/lib/quoteTotals";

function Harness({ initial = [], guests = 120 }: { initial?: LineItemInput[]; guests?: number }) {
  const [items, setItems] = useState<LineItemInput[]>(initial);
  const [guestCount, setGuestCount] = useState(guests);
  return (
    <>
      <AddOnItemsEditor items={items} onChange={setItems} guestCount={guestCount} currencySymbol="$" />
      <button type="button" onClick={() => setGuestCount(100)}>set-100-guests</button>
      <div data-testid="json">{JSON.stringify(items)}</div>
    </>
  );
}

const parse = (): LineItemInput[] => JSON.parse(screen.getByTestId("json").textContent!);
const line = (i: number) => screen.getByTestId(`addon-line-${i}`);
const openPicker = () => fireEvent.click(screen.getByText("+ Add item"));
const picker = () => screen.getByTestId("addon-picker");

const waitstaff: LineItemInput = {
  variant: null, category: "labor", description: "Server / Waitstaff",
  quantity: "8", unit: "each", unit_price: "220.00",
};

describe("AddOnItemsEditor — the chosen-lines card", () => {
  it("AC1: shows name, unit-price subtitle, stepper, line total and a remove", () => {
    render(<Harness initial={[waitstaff]} />);
    const row = line(0);
    expect(within(row).getByText("Server / Waitstaff")).toBeInTheDocument();
    expect(within(row).getByLabelText("Edit price for Server / Waitstaff")).toHaveTextContent("$220.00 each");
    expect(within(row).getByLabelText("Quantity for Server / Waitstaff")).toHaveValue(8);
    expect(within(row).getByText("$1,760.00")).toBeInTheDocument();
    expect(within(row).getByLabelText("Remove Server / Waitstaff")).toBeInTheDocument();
  });

  it("AC2: the stepper moves the line total and the subtotal without a save", () => {
    render(<Harness initial={[waitstaff]} />);
    fireEvent.click(screen.getByLabelText("Increase quantity for Server / Waitstaff"));
    expect(screen.getByLabelText("Quantity for Server / Waitstaff")).toHaveValue(9);
    expect(within(line(0)).getByText("$1,980.00")).toBeInTheDocument();
    expect(screen.getByText("Add-ons subtotal").parentElement).toHaveTextContent("$1,980.00");
    // and the decrement is the mirror of it
    fireEvent.click(screen.getByLabelText("Decrease quantity for Server / Waitstaff"));
    expect(screen.getByLabelText("Quantity for Server / Waitstaff")).toHaveValue(8);
  });

  it("AC3: a per-guest line is priced by guest count, whatever the stepper says", () => {
    const coffee: LineItemInput = {
      variant: null, category: "beverage", description: "Coffee & Tea Service",
      quantity: "1", unit: "per_guest", unit_price: "6.00",
    };
    render(<Harness initial={[coffee]} guests={120} />);
    expect(within(line(0)).getByText("$720.00")).toBeInTheDocument();
    // The stepper writes a quantity; the money ignores it — exactly as both engines do.
    fireEvent.click(screen.getByLabelText("Increase quantity for Coffee & Tea Service"));
    expect(within(line(0)).getByText("$720.00")).toBeInTheDocument();
    // Change the booking's guest count and the line follows it.
    fireEvent.click(screen.getByText("set-100-guests"));
    expect(within(line(0)).getByText("$600.00")).toBeInTheDocument();
  });

  it("AC4: the price subtitle opens an input that reprices the line", () => {
    render(<Harness initial={[waitstaff]} />);
    fireEvent.click(screen.getByLabelText("Edit price for Server / Waitstaff"));
    const input = screen.getByLabelText("Unit price for Server / Waitstaff");
    expect(input).toHaveFocus();
    fireEvent.change(input, { target: { value: "250" } });
    expect(within(line(0)).getByText("$2,000.00")).toBeInTheDocument();
    expect(parse()[0].unit_price).toBe("250");
    // Enter closes the editor and the subtitle shows the new price.
    fireEvent.keyDown(input, { key: "Enter" });
    expect(screen.getByLabelText("Edit price for Server / Waitstaff")).toHaveTextContent("$250.00 each");
  });

  it("AC5: ✕ removes the line and drops the subtotal by its total", () => {
    render(
      <Harness
        initial={[
          waitstaff,
          { variant: 11, category: "beverage", description: "Soft Drinks · 1.5L", quantity: "2", unit: "each", unit_price: "150.00" },
          { variant: null, category: "fee", description: "Delivery & Setup", quantity: "1", unit: "flat", unit_price: "450.00" },
        ]}
      />,
    );
    expect(screen.getByText("Add-ons subtotal").parentElement).toHaveTextContent("$2,510.00");
    fireEvent.click(screen.getByLabelText("Remove Soft Drinks · 1.5L"));
    expect(parse()).toHaveLength(2);
    expect(screen.queryByText("Soft Drinks · 1.5L")).not.toBeInTheDocument();
    expect(screen.getByText("Add-ons subtotal").parentElement).toHaveTextContent("$2,210.00");
  });

  it("AC6: the card subtotal is the same number the booking totals card shows", () => {
    const items: LineItemInput[] = [
      waitstaff,
      { variant: 11, category: "beverage", description: "Soft Drinks · 1.5L", quantity: "3", unit: "each", unit_price: "150.00" },
      { variant: null, category: "beverage", description: "Coffee & Tea Service", quantity: "1", unit: "per_guest", unit_price: "6.00" },
      { variant: null, category: "discount", description: "Loyalty discount", quantity: "1", unit: "each", unit_price: "100.00" },
    ];
    render(<Harness initial={items} guests={120} />);
    // Exactly how the pages derive the totals card's "Add-on items" row.
    const totals = computeBookingTotals(500, items, 120, 0);
    const addOnsRow = Math.round((totals.subtotal - totals.food_total) * 100) / 100;
    expect(screen.getByText("Add-ons subtotal").parentElement)
      .toHaveTextContent(`$${addOnsRow.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`);
  });

  it("AC7: an empty card is a hint and the two add buttons — no catalogue, no subtotal", () => {
    render(<Harness />);
    expect(screen.getByText(/Nothing added yet/)).toBeInTheDocument();
    expect(screen.queryByText("Add-ons subtotal")).not.toBeInTheDocument();
    expect(screen.getByText("+ Add item")).toBeInTheDocument();
    expect(screen.getByText("Custom item")).toBeInTheDocument();
    // The catalogue is behind the picker — none of it is on the card.
    expect(screen.queryByText("Milkshake")).not.toBeInTheDocument();
    expect(screen.queryByTestId("addon-picker")).not.toBeInTheDocument();
  });

  it("AC16: a discount line reads negative and pulls the subtotal down", () => {
    render(
      <Harness
        initial={[
          waitstaff,
          { variant: null, category: "discount", description: "Loyalty discount", quantity: "1", unit: "each", unit_price: "100.00" },
        ]}
      />,
    );
    expect(within(line(1)).getByText("-$100.00")).toBeInTheDocument();
    expect(screen.getByText("Add-ons subtotal").parentElement).toHaveTextContent("$1,660.00");
  });
});

describe("AddOnItemsEditor — the catalogue picker", () => {
  it("AC8: + Add item opens it with the search focused; esc and Cancel close it", () => {
    render(<Harness initial={[waitstaff]} />);
    openPicker();
    expect(screen.getByLabelText("Search add-ons")).toHaveFocus();

    fireEvent.keyDown(window, { key: "Escape" });
    expect(screen.queryByTestId("addon-picker")).not.toBeInTheDocument();
    expect(parse()).toHaveLength(1); // nothing changed on the way out

    openPicker();
    fireEvent.click(within(picker()).getByText("Cancel"));
    expect(screen.queryByTestId("addon-picker")).not.toBeInTheDocument();
    expect(parse()).toHaveLength(1);
  });

  it("AC9: search filters by name and empties the categories that no longer match", () => {
    render(<Harness />);
    openPicker();
    expect(within(picker()).getByLabelText("Add Delivery & Setup")).toBeInTheDocument();

    // "Fees" reads twice to begin with: once as a tab, once as a group heading.
    expect(within(picker()).getAllByText("Fees")).toHaveLength(2);

    fireEvent.change(screen.getByLabelText("Search add-ons"), { target: { value: "milk" } });
    expect(within(picker()).getByLabelText("Add Milkshake")).toBeInTheDocument();
    expect(within(picker()).queryByLabelText("Add Delivery & Setup")).not.toBeInTheDocument();
    // The group is gone; the tab stays put so the row of tabs doesn't jump as you type.
    expect(within(picker()).getAllByText("Fees")).toHaveLength(1);

    fireEvent.change(screen.getByLabelText("Search add-ons"), { target: { value: "" } });
    expect(within(picker()).getByLabelText("Add Delivery & Setup")).toBeInTheDocument();
  });

  it("AC9: a variant name is searchable too, and a miss says so", () => {
    render(<Harness />);
    openPicker();
    fireEvent.change(screen.getByLabelText("Search add-ons"), { target: { value: "tins" } });
    expect(within(picker()).getByLabelText("Add Soft Drinks · Tins")).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("Search add-ons"), { target: { value: "zzz" } });
    expect(within(picker()).getByText("No items match.")).toBeInTheDocument();
  });

  it("AC10: tabs are All plus only the categories the catalogue actually has", () => {
    render(<Harness />);
    openPicker();
    const tabBar = screen.getByTestId("addon-picker-tabs");
    // In the caterer's order, and only the categories the catalogue has: no product
    // is food or discount, so neither tab exists.
    expect(within(tabBar).getAllByRole("button").map((b) => b.textContent))
      .toEqual(["All", "Beverages", "Arrangements & rentals", "Labour", "Fees"]);

    fireEvent.click(within(tabBar).getByText("Labour"));
    expect(within(picker()).getByLabelText("Add Server / Waitstaff")).toBeInTheDocument();
    expect(within(picker()).queryByLabelText("Add Milkshake")).not.toBeInTheDocument();
  });

  it("AC11: a variant-less product adds in one click, then reads 'on quote' and is inert", () => {
    render(<Harness />);
    openPicker();
    expect(within(picker()).getByLabelText("Add Delivery & Setup")).toHaveTextContent("$450.00 flat");
    fireEvent.click(within(picker()).getByLabelText("Add Delivery & Setup"));

    expect(parse()).toEqual([
      { variant: null, category: "fee", description: "Delivery & Setup", quantity: "1", unit: "flat", unit_price: "450.00" },
    ]);
    const onQuote = within(picker()).getByLabelText("Delivery & Setup — already on quote");
    expect(onQuote).toBeDisabled();
    expect(onQuote).toHaveTextContent("on quote");
    fireEvent.click(onQuote);
    expect(parse()).toHaveLength(1); // clicking again adds nothing
  });

  it("AC12: a multi-variant product offers a chip per variant, added independently", () => {
    render(<Harness />);
    openPicker();
    expect(within(picker()).getByLabelText("Add Soft Drinks · 1.5L")).toHaveTextContent("1.5L · $150.00");
    expect(within(picker()).getByLabelText("Add Soft Drinks · Tins")).toHaveTextContent("Tins · $80.00");

    fireEvent.click(within(picker()).getByLabelText("Add Soft Drinks · 1.5L"));
    expect(parse()).toEqual([
      { variant: 11, category: "beverage", description: "Soft Drinks · 1.5L", quantity: "1", unit: "each", unit_price: "150.00" },
    ]);
    expect(within(line(0)).getByText("Soft Drinks · 1.5L")).toBeInTheDocument();
    expect(within(line(0)).getByLabelText("Edit price for Soft Drinks · 1.5L")).toHaveTextContent("$150.00 each");

    // That chip is spent; its sibling is not.
    expect(within(picker()).getByLabelText("Soft Drinks · 1.5L — already on quote")).toBeDisabled();
    fireEvent.click(within(picker()).getByLabelText("Add Soft Drinks · Tins"));
    expect(parse()).toHaveLength(2);
    expect(parse()[1].variant).toBe(12);
  });

  it("AC17: a non-featured product is in the picker like any other", () => {
    render(<Harness />);
    openPicker();
    const row = within(picker()).getByLabelText("Add Table Linens");
    expect(row).toHaveTextContent("$25.00 each");
    fireEvent.click(row);
    expect(parse()[0]).toMatchObject({ description: "Table Linens", unit_price: "25.00", category: "rental" });
  });

  it("AC15: Custom item adds a fully editable ad-hoc line with no variant", () => {
    render(<Harness />);
    fireEvent.click(screen.getByText("Custom item"));
    expect(parse()).toEqual([
      { variant: null, category: "fee", description: "", quantity: "1", unit: "each", unit_price: "" },
    ]);

    fireEvent.change(screen.getByLabelText("Description for item 1"), { target: { value: "Coat check" } });
    fireEvent.change(screen.getByLabelText("Category for item 1"), { target: { value: "labor" } });
    fireEvent.change(screen.getByLabelText("Unit for item 1"), { target: { value: "per_hour" } });
    fireEvent.change(screen.getByLabelText("Unit price for Coat check"), { target: { value: "100" } });
    fireEvent.click(screen.getByLabelText("Increase quantity for Coat check"));

    expect(parse()[0]).toEqual({
      variant: null, category: "labor", description: "Coat check",
      quantity: "2", unit: "per_hour", unit_price: "100",
    });
    expect(within(line(0)).getByText("$200.00")).toBeInTheDocument();
  });
});
