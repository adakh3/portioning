"use client";

import type { AddOnProduct } from "@/lib/api";
import type { LineItemInput } from "@/lib/quoteTotals";
import InlinePicker from "@/components/InlinePicker";
import { formatCurrency } from "@/lib/utils";
import {
  CATEGORY_LABELS, CATEGORY_ORDER, hasProduct, hasVariant,
  productLine, unitLabel, variantDescription, variantLine,
} from "@/lib/addOns";

/** The add-on catalogue, opened inline under the lines it adds to (REL-454).
 *
 * Same shell as the dish library (`InlinePicker`), with the two things a catalogue
 * of *priced* things needs and a dish list doesn't: the price and unit on the row,
 * so you can pick by cost without adding first, and variants as inline chips, so a
 * product with three sizes is one row rather than three.
 *
 * `is_featured` is deliberately not consulted: everything active is here, which is
 * the whole point of hiding the catalogue behind a search box. */
export default function AddOnPickerInline({
  products,
  items,
  onAdd,
  onClose,
  currencySymbol,
}: {
  products: AddOnProduct[];
  /** The booking's current lines — what to grey out as "on quote". */
  items: LineItemInput[];
  onAdd: (line: LineItemInput) => void;
  onClose: () => void;
  currencySymbol: string;
}) {
  const fmt = (v: string | number) => formatCurrency(v, currencySymbol);

  // Tabs come from the whole catalogue, not the search results, so they hold still
  // while you type. Unknown categories sort in after the ones we know.
  const present = Array.from(new Set(products.map((p) => p.category)));
  const ordered = [
    ...CATEGORY_ORDER.filter((c) => present.includes(c)),
    ...present.filter((c) => !CATEGORY_ORDER.includes(c)),
  ];
  const tabs = ordered.map((c) => ({ key: c, label: CATEGORY_LABELS[c] || c }));

  /** A product matches on its own name or any of its variants' — otherwise "tins"
   * finds nothing, and the variant is the part the caterer is actually shopping for. */
  const matches = (p: AddOnProduct, term: string) =>
    !term ||
    p.name.toLowerCase().includes(term) ||
    p.variants.some((v) => v.name?.toLowerCase().includes(term));

  return (
    <InlinePicker
      testId="addon-picker"
      ariaLabel="Add an item to this booking"
      searchLabel="Search add-ons"
      searchPlaceholder="Search beverages, rentals, staff…"
      emptyMessage="No items match."
      tabs={tabs}
      onClose={onClose}
    >
      {(term, tab) =>
        ordered
          .filter((cat) => tab === null || cat === tab)
          .map((cat) => ({
            cat,
            products: products.filter((p) => p.category === cat && matches(p, term)),
          }))
          .filter(({ products: ps }) => ps.length > 0)
          .map(({ cat, products: ps }) => ({
            key: cat,
            label: CATEGORY_LABELS[cat] || cat,
            count: ps.length,
            rows: ps.map((p) =>
              p.variants.length > 1 ? (
                <div key={p.id} className="px-3 py-1.5">
                  <p className="text-sm text-foreground">{p.name}</p>
                  <div className="mt-1 flex flex-wrap gap-1.5">
                    {p.variants.map((v) => {
                      const onQuote = hasVariant(items, v.id);
                      const label = variantDescription(p, v);
                      return (
                        <button
                          type="button"
                          key={v.id}
                          disabled={onQuote}
                          aria-label={onQuote ? `${label} — already on quote` : `Add ${label}`}
                          onClick={() => onAdd(variantLine(p, v))}
                          className={`rounded-full border px-2.5 py-1 text-xs transition-colors ${
                            onQuote
                              ? "cursor-default border-border text-muted-foreground/60"
                              : "border-border text-foreground hover:bg-accent"
                          }`}
                        >
                          {onQuote ? (
                            <>
                              {v.name || p.name} <span className="ml-1">on quote</span>
                            </>
                          ) : (
                            <>
                              <span aria-hidden="true" className="text-primary">+</span>{" "}
                              {v.name || p.name} · {fmt(v.unit_price)}
                            </>
                          )}
                        </button>
                      );
                    })}
                  </div>
                </div>
              ) : (
                // No variants, or exactly one: a single row that adds in one click.
                (() => {
                  const v = p.variants[0];
                  const onQuote = v ? hasVariant(items, v.id) : hasProduct(items, p);
                  const price = v ? v.unit_price : p.unit_price;
                  return (
                    <button
                      type="button"
                      key={p.id}
                      disabled={onQuote}
                      aria-label={onQuote ? `${p.name} — already on quote` : `Add ${p.name}`}
                      onClick={() => onAdd(v ? variantLine(p, v) : productLine(p))}
                      className={`flex w-full items-center gap-2 px-3 py-1.5 text-left text-sm ${
                        onQuote
                          ? "cursor-default text-muted-foreground/60"
                          : "text-foreground hover:bg-accent"
                      }`}
                    >
                      <span>{p.name}</span>
                      <span className="ml-auto text-xs text-muted-foreground">
                        {fmt(price)} {unitLabel(p.default_unit)}
                      </span>
                      <span className="text-xs">
                        {onQuote ? (
                          <span className="text-muted-foreground">on quote</span>
                        ) : (
                          <span aria-hidden="true" className="text-primary">+</span>
                        )}
                      </span>
                    </button>
                  );
                })()
              ),
            ),
          }))
      }
    </InlinePicker>
  );
}
