"use client";

import { useEffect, useMemo, useRef, useState } from "react";

export type SearchableOption = {
  value: string;
  /** What the row reads, and what the search matches against. */
  label: string;
  /** Optional muted second line — a date, a type, anything that disambiguates
   * two people with the same name. Also searchable. */
  hint?: string;
};

/**
 * A select you can type into, for lists that grow with the business.
 *
 * A native `<select>` is the right control for a handful of fixed options — it is
 * faster, keyboard-native and far better on mobile. It stops being the right
 * control somewhere around twenty: linking a quote to one of fifty leads meant
 * scrolling a list the height of the screen, hunting for a name. This is for that
 * case only; short org-configured lists (service style, meal type) stay native.
 *
 * Deliberately not a library: the app already carries @dnd-kit and SWR, and this
 * needs a text input, a filtered list and arrow keys.
 */
export default function SearchableSelect({
  value,
  onChange,
  options,
  emptyLabel,
  placeholder = "Search…",
  ariaLabel,
  disabled = false,
}: {
  value: string;
  onChange: (value: string) => void;
  options: SearchableOption[];
  /** The "none selected" row, e.g. "-- No lead (standalone quote) --". Always
   * offered, so clearing a choice never means reloading the page. */
  emptyLabel: string;
  placeholder?: string;
  ariaLabel: string;
  disabled?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");
  const [active, setActive] = useState(0);
  const rootRef = useRef<HTMLDivElement>(null);

  const selected = options.find((o) => o.value === value);
  const term = search.trim().toLowerCase();
  const matches = useMemo(() => {
    const rows = [{ value: "", label: emptyLabel }, ...options];
    if (!term) return rows;
    return rows.filter(
      (o) =>
        o.value === "" ||
        o.label.toLowerCase().includes(term) ||
        (o as SearchableOption).hint?.toLowerCase().includes(term),
    );
  }, [options, emptyLabel, term]);

  /** A search that excluded every real option — the empty row alone isn't an answer. */
  const noRealMatches = matches.every((o) => o.value === "");

  // Clicking anywhere else closes it — the same expectation a native select sets.
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [open]);

  useEffect(() => setActive(0), [term]);

  const choose = (v: string) => {
    onChange(v);
    setOpen(false);
    setSearch("");
  };

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Escape") { setOpen(false); setSearch(""); return; }
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      setActive((i) => {
        const next = e.key === "ArrowDown" ? i + 1 : i - 1;
        return Math.max(0, Math.min(next, matches.length - 1));
      });
      return;
    }
    if (e.key === "Enter" && open) {
      e.preventDefault();
      const row = matches[active];
      if (row) choose(row.value);
    }
  };

  return (
    <div ref={rootRef} className="relative" onKeyDown={onKeyDown}>
      <button
        type="button"
        aria-label={ariaLabel}
        aria-haspopup="listbox"
        aria-expanded={open}
        disabled={disabled}
        onClick={() => { setOpen((o) => !o); setSearch(""); }}
        className="flex h-9 w-full items-center justify-between rounded-md border border-input bg-background px-3 text-left text-sm shadow-sm focus:outline-none focus:ring-1 focus:ring-ring disabled:cursor-not-allowed disabled:opacity-50"
      >
        <span className={selected ? "text-foreground" : "text-muted-foreground"}>
          {selected ? selected.label : emptyLabel}
        </span>
        <svg className="ml-2 h-4 w-4 shrink-0 opacity-50" fill="none" viewBox="0 0 24 24"
             stroke="currentColor" strokeWidth={2} aria-hidden="true">
          <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
        </svg>
      </button>

      {open && (
        <div className="absolute z-20 mt-1 w-full rounded-lg border border-border bg-background shadow-lg">
          <div className="border-b border-border px-3 py-2">
            <input
              type="text"
              autoFocus
              aria-label={`Search ${ariaLabel.toLowerCase()}`}
              placeholder={placeholder}
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="w-full bg-transparent text-sm placeholder:text-muted-foreground focus:outline-none"
            />
          </div>
          {/* The empty row always survives the filter, so the list is never truly
              empty — without this, a search that matched nothing looked like a
              list containing only "no selection", with no hint that a term was
              excluding everything. */}
          {term && noRealMatches && (
            <p className="border-b border-border px-3 py-2 text-sm text-muted-foreground">
              No matches.
            </p>
          )}
          <ul role="listbox" aria-label={ariaLabel} className="max-h-64 overflow-y-auto py-1">
            {matches.map((o, i) => (
                <li key={o.value || "__none__"}>
                  <button
                    type="button"
                    role="option"
                    aria-selected={o.value === value}
                    onMouseEnter={() => setActive(i)}
                    onClick={() => choose(o.value)}
                    className={`flex w-full flex-col items-start px-3 py-1.5 text-left text-sm ${
                      i === active ? "bg-accent" : ""
                    } ${o.value === value ? "font-medium text-foreground" : "text-foreground"}`}
                  >
                    <span>{o.label}</span>
                    {(o as SearchableOption).hint && (
                      <span className="text-xs text-muted-foreground">
                        {(o as SearchableOption).hint}
                      </span>
                    )}
                  </button>
                </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
