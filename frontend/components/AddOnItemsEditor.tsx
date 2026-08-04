"use client";

import { useState } from "react";
import { useAddOnProducts } from "@/lib/hooks";
import { LineItemInput, lineItemTotal } from "@/lib/quoteTotals";
import { formatCurrency } from "@/lib/utils";
import AddOnPickerInline from "@/components/AddOnPickerInline";
import { ADDON_CATEGORIES, ADDON_UNITS, unitLabel } from "@/lib/addOns";

const cellInput = "h-8 rounded border border-input bg-transparent px-2 text-sm";

/**
 * The add-on items on a booking — shared by quote create, quote edit and the event
 * page. Emits `LineItemInput[]`; the save payload is built by `buildLineItemsPayload`.
 *
 * The card lists **only what is on this booking** — name, unit price, quantity,
 * line total — and the catalogue lives behind a searchable picker (REL-454). It used
 * to be the other way round: forty catalogue checkboxes on screen at all times, with
 * the four lines the booking actually had hidden among them and their prices only
 * visible once ticked.
 *
 * The money is untouched by all of this: every line total is `lineItemTotal`, the
 * same mirror of the backend the totals card uses. In particular a `per_guest` line
 * is priced `unit_price × guest_count` and its stored quantity is ignored — the
 * stepper still writes one (as it always has), it just isn't what the line costs.
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
  const { data: products = [], isLoading } = useAddOnProducts();
  const [pickerOpen, setPickerOpen] = useState(false);
  /** Which line's price subtitle has been clicked open for editing. */
  const [priceEditIdx, setPriceEditIdx] = useState<number | null>(null);

  const update = (i: number, field: keyof LineItemInput, value: unknown) =>
    onChange(items.map((it, idx) => (idx === i ? { ...it, [field]: value } : it)));
  const removeAt = (i: number) => {
    setPriceEditIdx(null); // indices shift under it
    onChange(items.filter((_, idx) => idx !== i));
  };
  const add = (item: LineItemInput) => onChange([...items, item]);

  // A catalogue line is one we can name from the catalogue: a variant (matched by
  // id) or a variant-less product (matched by name, as it always has been). Anything
  // else is the caterer's own line and stays fully editable.
  // While the catalogue is still in flight nothing is called custom yet: flipping a
  // saved line into an editable form the moment the fetch lands would yank the row
  // out from under a click.
  const productNames = new Set(products.filter((p) => !p.variants.length).map((p) => p.name));
  const isCustom = (it: LineItemInput) =>
    !it.variant && !isLoading && !productNames.has(it.description);

  const fmt = (v: string | number) => formatCurrency(v, currencySymbol);
  /** Money that can be negative (a discount line) reads "-$100.00", not "$-100.00". */
  const money = (n: number) => (n < 0 ? `-${fmt(Math.abs(n))}` : fmt(n));

  const subtotal =
    Math.round(items.reduce((t, it) => t + lineItemTotal(it, guestCount), 0) * 100) / 100;

  /** How a row's controls name themselves. Falls back to the position so a
   * just-added blank custom line still has usable labels. */
  const rowName = (it: LineItemInput, i: number) => it.description?.trim() || `item ${i + 1}`;

  const setQty = (i: number, n: number) => update(i, "quantity", String(Math.max(1, n)));

  function stepper(it: LineItemInput, i: number) {
    const name = rowName(it, i);
    return (
      <div className="flex items-center rounded-md border border-input">
        <button
          type="button"
          aria-label={`Decrease quantity for ${name}`}
          onClick={() => setQty(i, (Number(it.quantity) || 0) - 1)}
          className="px-2 py-1 text-sm text-muted-foreground hover:text-foreground"
        >
          &minus;
        </button>
        <input
          type="number"
          min={0}
          step="0.01"
          aria-label={`Quantity for ${name}`}
          value={it.quantity}
          onChange={(e) => update(i, "quantity", e.target.value)}
          className="w-12 border-x border-input bg-transparent py-1 text-center text-sm [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none"
        />
        <button
          type="button"
          aria-label={`Increase quantity for ${name}`}
          onClick={() => setQty(i, (Number(it.quantity) || 0) + 1)}
          className="px-2 py-1 text-sm text-muted-foreground hover:text-foreground"
        >
          +
        </button>
      </div>
    );
  }

  /** The unit-price subtitle: a button until clicked, an input while editing. */
  function priceField(it: LineItemInput, i: number) {
    const name = rowName(it, i);
    if (priceEditIdx === i) {
      return (
        <input
          type="number"
          min={0}
          step="0.01"
          autoFocus
          aria-label={`Unit price for ${name}`}
          value={it.unit_price}
          placeholder="0.00"
          onChange={(e) => update(i, "unit_price", e.target.value)}
          onBlur={() => setPriceEditIdx(null)}
          onKeyDown={(e) => {
            if (e.key === "Enter" || e.key === "Escape") {
              e.preventDefault();
              setPriceEditIdx(null);
            }
          }}
          className="mt-0.5 h-7 w-24 rounded border border-input bg-transparent px-2 text-sm [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none"
        />
      );
    }
    return (
      <button
        type="button"
        aria-label={`Edit price for ${name}`}
        onClick={() => setPriceEditIdx(i)}
        className="text-xs text-muted-foreground hover:text-foreground hover:underline"
      >
        {fmt(it.unit_price || 0)} {unitLabel(it.unit)}
      </button>
    );
  }

  function removeButton(it: LineItemInput, i: number) {
    return (
      <button
        type="button"
        aria-label={`Remove ${rowName(it, i)}`}
        onClick={() => removeAt(i)}
        className="px-1 text-muted-foreground hover:text-destructive"
      >
        &times;
      </button>
    );
  }

  return (
    <div className="space-y-3">
      {items.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          Nothing added yet — beverages, rentals, staff and fees all live in the picker.
        </p>
      ) : (
        <div>
          {items.map((it, i) => (
            <div
              key={i}
              data-testid={`addon-line-${i}`}
              className="flex items-start gap-3 border-b border-border/50 py-2 last:border-0"
            >
              <div className="min-w-0 flex-1">
                {isCustom(it) ? (
                  <div className="flex flex-wrap items-center gap-2">
                    <input
                      aria-label={`Description for item ${i + 1}`}
                      placeholder="Description"
                      value={it.description}
                      onChange={(e) => update(i, "description", e.target.value)}
                      className={`${cellInput} min-w-[10rem] flex-1`}
                    />
                    <select
                      aria-label={`Category for item ${i + 1}`}
                      value={it.category}
                      onChange={(e) => update(i, "category", e.target.value)}
                      className={cellInput}
                    >
                      {ADDON_CATEGORIES.map(([v, l]) => (
                        <option key={v} value={v}>{l}</option>
                      ))}
                    </select>
                    <select
                      aria-label={`Unit for item ${i + 1}`}
                      value={it.unit}
                      onChange={(e) => update(i, "unit", e.target.value)}
                      className={cellInput}
                    >
                      {ADDON_UNITS.map(([v, l]) => (
                        <option key={v} value={v}>{l}</option>
                      ))}
                    </select>
                    <input
                      type="number"
                      min={0}
                      step="0.01"
                      aria-label={`Unit price for ${rowName(it, i)}`}
                      placeholder="0.00"
                      value={it.unit_price}
                      onChange={(e) => update(i, "unit_price", e.target.value)}
                      className={`${cellInput} w-24 text-right [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none`}
                    />
                  </div>
                ) : (
                  <>
                    <p className="truncate text-sm text-foreground">{it.description}</p>
                    {priceField(it, i)}
                  </>
                )}
              </div>
              {stepper(it, i)}
              <span className="w-24 whitespace-nowrap pt-1 text-right text-sm font-medium text-foreground">
                {money(lineItemTotal(it, guestCount))}
              </span>
              <span className="pt-1">{removeButton(it, i)}</span>
            </div>
          ))}

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
        <button
          type="button"
          onClick={() =>
            add({ variant: null, category: "fee", description: "", quantity: "1", unit: "each", unit_price: "" })
          }
          className="text-sm text-primary hover:underline"
        >
          Custom item
        </button>
      </div>
    </div>
  );
}
