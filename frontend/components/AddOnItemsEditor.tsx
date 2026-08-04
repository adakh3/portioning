"use client";

import { useState } from "react";
import { useAddOnProducts } from "@/lib/hooks";
import { LineItemInput, lineItemTotal } from "@/lib/quoteTotals";
import { formatCurrency } from "@/lib/utils";
import AddOnPickerInline from "@/components/AddOnPickerInline";
import { ADDON_CATEGORIES, ADDON_UNITS, unitLabel } from "@/lib/addOns";

const smallInput = "h-7 rounded border border-input bg-transparent px-2 text-sm";
const spinnerless =
  "[appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none";

/**
 * The add-on items on a booking — shared by quote create, quote edit and the event
 * page. Emits `LineItemInput[]`; the save payload is built by `buildLineItemsPayload`.
 *
 * The card lists **only what is on this booking** — name, unit price, quantity, line
 * total — and the catalogue lives behind a searchable picker (REL-454). It used to be
 * the other way round: forty catalogue checkboxes on screen at all times, with the
 * four lines the booking actually had hidden among them and their prices only visible
 * once ticked.
 *
 * **Every row is the same row.** There is deliberately no "catalogue line" vs "custom
 * line" split: a line's name, price, unit and category are all editable in place,
 * whether it came from the picker or was typed by hand. An earlier cut of this card
 * decided the shape from the description (a line named after a catalogue product read
 * as a catalogue line), which meant a row could change shape *while you were typing
 * into it* and strand itself on the wrong unit with no control left to fix it — on the
 * common path, since every product in the US starter catalogue is variant-less. One
 * shape cannot do that. The description is still matched by name in the *picker*, to
 * decide what reads "on quote"; that is a display hint, and nothing depends on it.
 *
 * The money is untouched by all of this: every line total is `lineItemTotal`, the same
 * mirror of the backend the totals card uses. In particular a `per_guest` line is
 * priced `unit_price × guest_count` and its stored quantity is ignored — the stepper
 * still writes one (as it always has), it just isn't what the line costs, which is why
 * that subtitle spells out the guest count it is actually multiplied by.
 */
export default function AddOnItemsEditor({
  items,
  onChange,
  guestCount,
  currencySymbol,
}: {
  items: LineItemInput[];
  onChange: (items: LineItemInput[]) => void;
  guestCount: number;
  currencySymbol: string;
}) {
  const { data: products = [] } = useAddOnProducts();
  const [pickerOpen, setPickerOpen] = useState(false);
  /** Which line has its name open for editing, and which has its price/unit/category
   * strip open. Both are row indices, so both are dropped whenever a row leaves. */
  const [editingName, setEditingName] = useState<number | null>(null);
  const [editingDetails, setEditingDetails] = useState<number | null>(null);

  const update = (i: number, field: keyof LineItemInput, value: unknown) =>
    onChange(items.map((it, idx) => (idx === i ? { ...it, [field]: value } : it)));
  const removeAt = (i: number) => {
    setEditingName(null);
    setEditingDetails(null);
    onChange(items.filter((_, idx) => idx !== i));
  };
  const add = (item: LineItemInput) => onChange([...items, item]);
  /** A hand-typed line opens straight into its name field — an unnamed row with
   * nothing focused reads as a bug rather than an invitation. */
  const addCustom = () => {
    setEditingName(items.length);
    setEditingDetails(null);
    add({ variant: null, category: "fee", description: "", quantity: "1", unit: "each", unit_price: "" });
  };

  const fmt = (v: string | number) => formatCurrency(v, currencySymbol);
  /** Money that can be negative (a discount line) reads "-$100.00", not "$-100.00". */
  const money = (n: number) => (n < 0 ? `-${fmt(Math.abs(n))}` : fmt(n));

  const subtotal =
    Math.round(items.reduce((t, it) => t + lineItemTotal(it, guestCount), 0) * 100) / 100;

  const setQty = (i: number, n: number) => update(i, "quantity", String(Math.max(1, n)));

  /** Esc closes the editor it was pressed in — and must not also reach the picker's
   * window listener, which would close both at once. */
  const closeOnKey = (e: React.KeyboardEvent, close: () => void) => {
    if (e.key === "Enter" || e.key === "Escape") {
      e.preventDefault();
      e.nativeEvent.stopPropagation();
      close();
    }
  };

  return (
    <div className="space-y-3">
      {items.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          Nothing added yet — beverages, rentals, staff and fees all live in the picker.
        </p>
      ) : (
        <div>
          {items.map((it, i) => {
            const name = it.description?.trim();
            return (
              <div
                key={i}
                data-testid={`addon-line-${i}`}
                role="group"
                // The row names itself so its controls don't have to: two lines with
                // the same description would otherwise give a screen reader two
                // identical "Remove" buttons with nothing to tell them apart.
                aria-label={`Add-on ${i + 1}: ${name || "unnamed"}`}
                className="flex items-start gap-3 border-b border-border/50 py-2 last:border-0"
              >
                <div className="min-w-0 flex-1">
                  {editingName === i ? (
                    <input
                      autoFocus
                      aria-label="Name"
                      placeholder="Name this item"
                      value={it.description}
                      onChange={(e) => update(i, "description", e.target.value)}
                      onBlur={() => setEditingName(null)}
                      onKeyDown={(e) => closeOnKey(e, () => setEditingName(null))}
                      className={`${smallInput} w-full`}
                    />
                  ) : (
                    <button
                      type="button"
                      aria-label="Edit name"
                      onClick={() => setEditingName(i)}
                      // Same height and text offset as the input it swaps with:
                      // otherwise finishing a name reflows the row and whatever you
                      // reach for next has already moved out from under the click.
                      className="-ml-2 flex h-7 max-w-full items-center px-2 text-left text-sm text-foreground hover:underline"
                    >
                      <span className="truncate">
                        {name || <span className="italic text-muted-foreground">Name this item</span>}
                      </span>
                    </button>
                  )}

                  {editingDetails === i ? (
                    <div
                      className="mt-1 flex flex-wrap items-center gap-2"
                      onKeyDown={(e) => closeOnKey(e, () => setEditingDetails(null))}
                    >
                      <input
                        type="number"
                        min={0}
                        step="0.01"
                        autoFocus
                        aria-label="Unit price"
                        placeholder="0.00"
                        value={it.unit_price}
                        onChange={(e) => update(i, "unit_price", e.target.value)}
                        className={`${smallInput} w-24 text-right ${spinnerless}`}
                      />
                      <select
                        aria-label="Unit"
                        value={it.unit}
                        onChange={(e) => update(i, "unit", e.target.value)}
                        className={smallInput}
                      >
                        {ADDON_UNITS.map(([v, l]) => (
                          <option key={v} value={v}>{l}</option>
                        ))}
                      </select>
                      <select
                        aria-label="Category"
                        value={it.category}
                        onChange={(e) => update(i, "category", e.target.value)}
                        className={smallInput}
                      >
                        {ADDON_CATEGORIES.map(([v, l]) => (
                          <option key={v} value={v}>{l}</option>
                        ))}
                      </select>
                      <button
                        type="button"
                        onClick={() => setEditingDetails(null)}
                        className="text-xs text-primary hover:underline"
                      >
                        Done
                      </button>
                    </div>
                  ) : (
                    <button
                      type="button"
                      aria-label="Edit price, unit and category"
                      onClick={() => setEditingDetails(i)}
                      className="text-xs text-muted-foreground hover:text-foreground hover:underline"
                    >
                      {fmt(it.unit_price || 0)} {unitLabel(it.unit)}
                      {/* The quantity is not what a per-guest line costs, so the
                          subtitle says what it IS multiplied by. */}
                      {it.unit === "per_guest" && ` × ${guestCount} guests`}
                    </button>
                  )}
                </div>

                <div className="flex items-center rounded-md border border-input">
                  <button
                    type="button"
                    aria-label="Decrease quantity"
                    onClick={() => setQty(i, (Number(it.quantity) || 0) - 1)}
                    className="px-2 py-1 text-sm text-muted-foreground hover:text-foreground"
                  >
                    &minus;
                  </button>
                  <input
                    type="number"
                    min={0}
                    step="0.01"
                    aria-label="Quantity"
                    value={it.quantity}
                    onChange={(e) => update(i, "quantity", e.target.value)}
                    className={`w-12 border-x border-input bg-transparent py-1 text-center text-sm ${spinnerless}`}
                  />
                  <button
                    type="button"
                    aria-label="Increase quantity"
                    onClick={() => setQty(i, (Number(it.quantity) || 0) + 1)}
                    className="px-2 py-1 text-sm text-muted-foreground hover:text-foreground"
                  >
                    +
                  </button>
                </div>

                <span className="w-24 whitespace-nowrap pt-1 text-right text-sm font-medium text-foreground">
                  {money(lineItemTotal(it, guestCount))}
                </span>
                <button
                  type="button"
                  aria-label="Remove"
                  onClick={() => removeAt(i)}
                  className="px-1 pt-0.5 text-muted-foreground hover:text-destructive"
                >
                  &times;
                </button>
              </div>
            );
          })}

          <div className="flex items-center justify-between border-t border-border pt-2 text-sm">
            <span className="text-muted-foreground">Add-ons subtotal</span>
            <span className="font-medium text-foreground">{money(subtotal)}</span>
          </div>
        </div>
      )}

      {pickerOpen && (
        <AddOnPickerInline
          products={products}
          items={items}
          onAdd={add}
          onClose={() => setPickerOpen(false)}
          currencySymbol={currencySymbol}
        />
      )}

      <div className="flex items-center gap-4">
        <button
          type="button"
          onClick={() => setPickerOpen((open) => !open)}
          className="text-sm text-primary hover:underline"
        >
          {pickerOpen ? "Done" : "+ Add item"}
        </button>
        <button type="button" onClick={addCustom} className="text-sm text-primary hover:underline">
          Custom item
        </button>
      </div>
    </div>
  );
}
