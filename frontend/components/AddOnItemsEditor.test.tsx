import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, within } from "@testing-library/react";
import { useState } from "react";

// The add-ons card is now a list of the lines ON this booking plus a searchable
// catalogue picker (REL-454). These cover the acceptance criteria for the card and
// the picker; the payload that reaches api.create*/update* is pinned by the
// page-level tests (page.addons.test.tsx on quotes and events), and save+reload by
// the Playwright spec.
//
// The fixture carries every product shape the picker has to handle: no variants,
// exactly one variant, several variants, a zero base price, and a NON-featured
// product (the flag is inert now). `h` is mutable so a test can put the catalogue
// back into its loading state or empty it.
const h = vi.hoisted(() => ({
  isLoading: false,
  products: [
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
    // Not featured. It must appear in the picker exactly like the rest (AC17) —
    // the flag no longer drives the UI.
    {
      id: 6, name: "Linens", category: "rental", default_unit: "each",
      unit_price: "25.00", is_taxable: true, is_featured: false, is_active: true, sort_order: 5,
    variants: [],
    },
    // Exactly ONE variant — reachable in production when a two-variant product has
    // one variant deactivated, and it takes the single-row branch, not the chips one.
    {
      id: 7, name: "Chair Covers", category: "rental", default_unit: "each",
      unit_price: "0.00", is_taxable: true, is_featured: true, is_active: true, sort_order: 6,
      variants: [{ id: 71, name: "Ivory", unit_price: "4.00", is_active: true, sort_order: 0 }],
    },
    // A product nobody has priced yet. "$0.00" would read as free.
    {
      id: 8, name: "Ice Sculpture", category: "rental", default_unit: "flat",
      unit_price: "0.00", is_taxable: true, is_featured: true, is_active: true, sort_order: 7,
      variants: [],
    },
  ],
}));

vi.mock("@/lib/hooks", () => ({
  useAddOnProducts: () => ({ data: h.products, isLoading: h.isLoading }),
}));

import AddOnItemsEditor from "./AddOnItemsEditor";
import { computeBookingTotals } from "@/lib/quoteTotals";
import { LineItemInput } from "@/lib/bookingPayload";

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
const line = (i: number) => within(screen.getByTestId(`addon-line-${i}`));
const openPicker = () => fireEvent.click(screen.getByText("+ Add item"));
const picker = () => screen.getByTestId("addon-picker");

const waitstaff: LineItemInput = {
  variant: null, category: "labor", description: "Server / Waitstaff",
  quantity: "8", unit: "each", unit_price: "220.00",
};

beforeEach(() => { h.isLoading = false; });

describe("AddOnItemsEditor — the chosen-lines card", () => {
  it("AC1: shows name, unit-price subtitle, stepper, line total and a remove", () => {
    render(<Harness initial={[waitstaff]} />);
    expect(line(0).getByLabelText("Edit name")).toHaveTextContent("Server / Waitstaff");
    expect(line(0).getByLabelText("Edit price and unit")).toHaveTextContent("$220.00 each");
    expect(line(0).getByLabelText("Quantity")).toHaveValue(8);
    expect(line(0).getByText("$1,760.00")).toBeInTheDocument();
    expect(line(0).getByLabelText("Remove")).toBeInTheDocument();
  });

  it("AC2: the stepper moves the line total and the subtotal without a save", () => {
    render(<Harness initial={[waitstaff]} />);
    fireEvent.click(line(0).getByLabelText("Increase quantity"));
    expect(line(0).getByLabelText("Quantity")).toHaveValue(9);
    expect(line(0).getByText("$1,980.00")).toBeInTheDocument();
    expect(screen.getByText("Add-ons subtotal").parentElement).toHaveTextContent("$1,980.00");
    fireEvent.click(line(0).getByLabelText("Decrease quantity"));
    expect(line(0).getByLabelText("Quantity")).toHaveValue(8);
  });

  it("the stepper will not take a line below 1", () => {
    render(<Harness initial={[{ ...waitstaff, quantity: "1" }]} />);
    fireEvent.click(line(0).getByLabelText("Decrease quantity"));
    expect(line(0).getByLabelText("Quantity")).toHaveValue(1);
    expect(parse()[0].quantity).toBe("1");
  });

  it("AC3: a per-guest line is priced by guest count, whatever the stepper says", () => {
    const coffee: LineItemInput = {
      variant: null, category: "beverage", description: "Coffee & Tea Service",
      quantity: "1", unit: "per_guest", unit_price: "6.00",
    };
    render(<Harness initial={[coffee]} guests={120} />);
    // The subtitle names the number the line is actually multiplied by.
    expect(line(0).getByLabelText("Edit price and unit")).toHaveTextContent("$6.00 per guest × 120 guests");
    expect(line(0).getByText("$720.00")).toBeInTheDocument();
    // The stepper writes a quantity; the money ignores it — exactly as both engines do.
    fireEvent.click(line(0).getByLabelText("Increase quantity"));
    expect(line(0).getByText("$720.00")).toBeInTheDocument();
    // Change the booking's guest count and the line follows it.
    fireEvent.click(screen.getByText("set-100-guests"));
    expect(line(0).getByText("$600.00")).toBeInTheDocument();
  });

  it("AC4: the price subtitle opens price + unit + category, and reprices the line", () => {
    render(<Harness initial={[waitstaff]} />);
    fireEvent.click(line(0).getByLabelText("Edit price and unit"));
    const input = line(0).getByLabelText("Unit price");
    expect(input).toHaveFocus();
    fireEvent.change(input, { target: { value: "250" } });
    expect(line(0).getByText("$2,000.00")).toBeInTheDocument();
    expect(parse()[0].unit_price).toBe("250");
    fireEvent.click(line(0).getByText("Done"));
    expect(line(0).getByLabelText("Edit price and unit")).toHaveTextContent("$250.00 each");
  });

  it("AC5: ✕ removes the line and drops the subtotal by its total", () => {
    render(
      <Harness
        initial={[
          waitstaff,
          { variant: 11, category: "beverage", description: "Soft Drinks — 1.5L", quantity: "2", unit: "each", unit_price: "150.00" },
          { variant: null, category: "fee", description: "Delivery & Setup", quantity: "1", unit: "flat", unit_price: "450.00" },
        ]}
      />,
    );
    expect(screen.getByText("Add-ons subtotal").parentElement).toHaveTextContent("$2,510.00");
    fireEvent.click(line(1).getByLabelText("Remove"));
    expect(parse()).toHaveLength(2);
    expect(screen.queryByText("Soft Drinks — 1.5L")).not.toBeInTheDocument();
    expect(screen.getByText("Add-ons subtotal").parentElement).toHaveTextContent("$2,210.00");
  });

  it("AC6: the card subtotal is the same number the booking totals card shows", () => {
    const items: LineItemInput[] = [
      waitstaff,
      { variant: 11, category: "beverage", description: "Soft Drinks — 1.5L", quantity: "3", unit: "each", unit_price: "150.00" },
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
    expect(line(1).getByText("-$100.00")).toBeInTheDocument();
    expect(screen.getByText("Add-ons subtotal").parentElement).toHaveTextContent("$1,660.00");
  });

  it("rows sharing a description are still told apart by their group label", () => {
    // Two identically-named lines used to give a screen reader two identical
    // "Remove" buttons with nothing to choose between them.
    render(<Harness initial={[{ ...waitstaff, description: "Extra" }, { ...waitstaff, description: "Extra" }]} />);
    expect(screen.getByRole("group", { name: "Add-on 1: Extra" })).toBeInTheDocument();
    expect(screen.getByRole("group", { name: "Add-on 2: Extra" })).toBeInTheDocument();
  });
});

describe("AddOnItemsEditor — every line stays editable", () => {
  // The regression these exist for: an earlier cut decided a row's shape from its
  // description, so naming a line after a catalogue product turned it into a
  // read-only-ish row mid-typing and took its unit control away — leaving it stranded
  // on the wrong unit. Every product in the US starter catalogue is variant-less, so
  // that was the common path, not an edge case.
  it("a line named exactly after a catalogue product keeps its name, unit and category", () => {
    render(<Harness />);
    fireEvent.click(screen.getByText("Custom item"));
    const name = line(0).getByLabelText("Name");
    fireEvent.change(name, { target: { value: "Soft Drinks" } });
    // Still the same input, still focused, still editable.
    expect(line(0).getByLabelText("Name")).toHaveValue("Soft Drinks");
    fireEvent.keyDown(name, { key: "Enter" });

    fireEvent.click(line(0).getByLabelText("Edit price and unit"));
    fireEvent.change(line(0).getByLabelText("Unit"), { target: { value: "per_guest" } });
    fireEvent.change(line(0).getByLabelText("Unit price"), { target: { value: "3" } });
    expect(parse()[0]).toMatchObject({ description: "Soft Drinks", unit: "per_guest", unit_price: "3" });
    // 120 guests × $3 — the line the caterer meant, not $3 flat.
    expect(line(0).getByText("$360.00")).toBeInTheDocument();
  });

  it("a catalogue line's unit and description can still be changed", () => {
    // Lines from non-featured catalogue products used to be fully editable in the old
    // 'other items' table; losing that would have made a $45/hr Bartender unbillable
    // as a flat fee without deleting and retyping it.
    render(<Harness initial={[{ variant: 71, category: "rental", description: "Chair Covers — Ivory", quantity: "1", unit: "each", unit_price: "4.00" }]} />);
    fireEvent.click(line(0).getByLabelText("Edit name"));
    fireEvent.change(line(0).getByLabelText("Name"), { target: { value: "Chair covers (ivory), 120" } });
    fireEvent.click(line(0).getByLabelText("Edit price and unit"));
    fireEvent.change(line(0).getByLabelText("Unit"), { target: { value: "flat" } });
    expect(parse()[0]).toMatchObject({
      variant: 71, description: "Chair covers (ivory), 120", unit: "flat", category: "rental",
    });
  });

  it("renders identically whether the catalogue has loaded, is loading, or is empty", () => {
    // The row shape must not depend on the catalogue at all — it used to, and a
    // fetch landing mid-click changed the row under the cursor.
    const shapes: string[] = [];
    for (const state of [{ isLoading: false }, { isLoading: true }, { isLoading: false, empty: true }]) {
      h.isLoading = state.isLoading;
      const saved = h.products;
      if (state.empty) h.products = [];
      const view = render(<Harness initial={[waitstaff]} />);
      shapes.push(screen.getByTestId("addon-line-0").innerHTML);
      view.unmount();
      h.products = saved;
    }
    expect(new Set(shapes).size).toBe(1);
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

  it("esc inside a line's price editor closes that editor, not the picker", () => {
    render(<Harness initial={[waitstaff]} />);
    openPicker();
    fireEvent.click(line(0).getByLabelText("Edit price and unit"));
    fireEvent.keyDown(line(0).getByLabelText("Unit price"), { key: "Escape" });
    expect(line(0).getByLabelText("Edit price and unit")).toBeInTheDocument();
    expect(screen.getByTestId("addon-picker")).toBeInTheDocument();
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
    expect(within(picker()).getByLabelText("Add Soft Drinks — Tins")).toBeInTheDocument();
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
    expect(within(picker()).getByLabelText("Add Soft Drinks — 1.5L")).toHaveTextContent("1.5L · $150.00");
    expect(within(picker()).getByLabelText("Add Soft Drinks — Tins")).toHaveTextContent("Tins · $80.00");

    fireEvent.click(within(picker()).getByLabelText("Add Soft Drinks — 1.5L"));
    expect(parse()).toEqual([
      { variant: 11, category: "beverage", description: "Soft Drinks — 1.5L", quantity: "1", unit: "each", unit_price: "150.00" },
    ]);
    expect(line(0).getByLabelText("Edit name")).toHaveTextContent("Soft Drinks — 1.5L");
    expect(line(0).getByLabelText("Edit price and unit")).toHaveTextContent("$150.00 each");

    // That chip is spent; its sibling is not.
    expect(within(picker()).getByLabelText("Soft Drinks — 1.5L — already on quote")).toBeDisabled();
    fireEvent.click(within(picker()).getByLabelText("Add Soft Drinks — Tins"));
    expect(parse()).toHaveLength(2);
    expect(parse()[1].variant).toBe(12);
  });

  it("a single-variant product is one row, priced from that variant", () => {
    render(<Harness />);
    openPicker();
    // One row under the product's own name (no chips) — but the line it adds carries
    // the variant, and is named for it, exactly as the old editor did.
    const row = within(picker()).getByLabelText("Add Chair Covers");
    expect(row).toHaveTextContent("$4.00 each");
    fireEvent.click(row);
    expect(parse()[0]).toEqual({
      variant: 71, category: "rental", description: "Chair Covers — Ivory",
      quantity: "1", unit: "each", unit_price: "4.00",
    });
    expect(within(picker()).getByLabelText("Chair Covers — already on quote")).toBeDisabled();
  });

  it("an unpriced product shows its unit, not a free-looking $0.00", () => {
    render(<Harness />);
    openPicker();
    const row = within(picker()).getByLabelText("Add Ice Sculpture");
    expect(row).toHaveTextContent("flat");
    expect(row).not.toHaveTextContent("$0.00");
  });

  it("AC17: a non-featured product is in the picker like any other", () => {
    render(<Harness />);
    openPicker();
    const row = within(picker()).getByLabelText("Add Linens");
    expect(row).toHaveTextContent("$25.00 each");
    fireEvent.click(row);
    expect(parse()[0]).toMatchObject({ description: "Linens", unit_price: "25.00", category: "rental" });
  });

  it("AC15: Custom item adds an ad-hoc line, open at its name, with no variant", () => {
    render(<Harness />);
    fireEvent.click(screen.getByText("Custom item"));
    expect(parse()).toEqual([
      { variant: null, category: "fee", description: "", quantity: "1", unit: "each", unit_price: "" },
    ]);
    // It opens straight into its name field — an unnamed row with nothing focused
    // reads as a bug rather than an invitation.
    expect(line(0).getByLabelText("Name")).toHaveFocus();

    fireEvent.change(line(0).getByLabelText("Name"), { target: { value: "Coat check" } });
    fireEvent.keyDown(line(0).getByLabelText("Name"), { key: "Enter" });
    fireEvent.click(line(0).getByLabelText("Edit price and unit"));
    fireEvent.change(line(0).getByLabelText("Unit"), { target: { value: "per_hour" } });
    fireEvent.change(line(0).getByLabelText("Unit price"), { target: { value: "100" } });
    fireEvent.click(line(0).getByLabelText("Increase quantity"));

    expect(parse()[0]).toEqual({
      variant: null, category: "fee", description: "Coat check",
      quantity: "2", unit: "per_hour", unit_price: "100",
    });
    expect(line(0).getByText("$200.00")).toBeInTheDocument();
  });

  it("offers no category control — a line keeps the category it arrived with", () => {
    // Owner, 2026-08-10: the user doesn't need to change category on this form at
    // all. The strip edits price and unit; category comes from the catalogue
    // product (or `fee` for custom lines) and only groups documents/picker tabs.
    render(<Harness initial={[{ variant: 71, category: "rental", description: "Chair Covers", quantity: "1", unit: "each", unit_price: "4.00" }]} />);
    fireEvent.click(line(0).getByLabelText("Edit price and unit"));
    expect(line(0).queryByLabelText("Category")).toBeNull();
    fireEvent.change(line(0).getByLabelText("Unit price"), { target: { value: "9" } });
    expect(parse()[0]).toMatchObject({ category: "rental", unit_price: "9" });
  });

  it("Add discount creates a negative flat line, price focused and renameable", () => {
    // The one way to put the `discount` category on a new row now that the
    // dropdown is gone. Interim until REL-475's totals-card control.
    render(<Harness initial={[]} />);
    fireEvent.click(screen.getByText("Add discount"));
    expect(parse()).toEqual([
      { variant: null, category: "discount", description: "Discount", quantity: "1", unit: "flat", unit_price: "" },
    ]);
    // It opens into the price — the name is prefilled, the amount is what's missing.
    expect(line(0).getByLabelText("Unit price")).toHaveFocus();
    // A priceless discount is −|0| = negative zero in JS; it must read $0.00,
    // not "$-0.00".
    expect(line(0).getByText("$0.00")).toBeInTheDocument();
    expect(line(0).queryByText(/-\s*\$?\s*-?0\.00|\$-0\.00/)).toBeNull();
    fireEvent.change(line(0).getByLabelText("Unit price"), { target: { value: "100" } });
    // Typed positive, rendered negative — the category supplies the sign.
    expect(line(0).getByText("-$100.00")).toBeInTheDocument();
    fireEvent.click(line(0).getByLabelText("Edit name"));
    fireEvent.change(line(0).getByLabelText("Name"), { target: { value: "Returning client" } });
    expect(parse()[0]).toMatchObject({ category: "discount", description: "Returning client" });
  });
});
