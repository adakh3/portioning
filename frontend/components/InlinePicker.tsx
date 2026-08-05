"use client";

import { useEffect, useState, type ReactNode } from "react";

/** One category's worth of results: a heading, a count, and the caller's rows. */
export interface PickerGroup {
  key: string;
  label: string;
  count: number;
  rows: ReactNode;
}

/**
 * The catalogue picker chrome, shared by the dish library and the add-on catalogue
 * (REL-454): a search box, category tabs, and category-grouped results in a scroll
 * body — opened inline where the thing being picked will land.
 *
 * The shell owns the search term and the active tab (identical behaviour for both
 * catalogues); the caller owns filtering and the row markup, because a dish row and
 * a priced add-on row share nothing but their position. That split is what keeps
 * this one component instead of two that drift apart.
 *
 * Three ways out, all obvious: Esc, the Cancel link, or the trigger that opened it
 * (whose label the caller owns).
 */
export default function InlinePicker({
  testId,
  ariaLabel,
  searchLabel,
  searchPlaceholder,
  emptyMessage,
  tabs,
  onClose,
  children,
}: {
  testId: string;
  ariaLabel: string;
  searchLabel: string;
  searchPlaceholder: string;
  /** Shown when the caller's filter comes back with nothing. */
  emptyMessage: string;
  /** Category tabs, in display order. "All" is prepended here, never by the caller. */
  tabs: { key: string; label: string }[];
  onClose: () => void;
  /** Filters and renders: given the lower-cased search term and the active tab
   * (`null` = All), return the groups to show. */
  children: (term: string, tab: string | null) => PickerGroup[];
}) {
  const [search, setSearch] = useState("");
  const [tab, setTab] = useState<string | null>(null);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const groups = children(search.trim().toLowerCase(), tab);

  return (
    <div
      data-testid={testId}
      role="group"
      aria-label={ariaLabel}
      className="my-2 rounded-lg border border-border bg-background"
    >
      <div className="flex items-center gap-2 border-b border-border px-3 py-2">
        <input
          type="text"
          autoFocus
          aria-label={searchLabel}
          placeholder={searchPlaceholder}
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="flex-1 bg-transparent text-sm placeholder:text-muted-foreground focus:outline-none"
        />
        <button
          type="button"
          onClick={onClose}
          className="text-sm text-muted-foreground hover:text-foreground"
        >
          Cancel
        </button>
        <kbd className="text-xs text-muted-foreground/70">esc</kbd>
      </div>

      {/* Its own testid: a tab and a group heading are the same word, so anything
          asserting on one has to be able to say which. */}
      <div data-testid={`${testId}-tabs`} className="flex flex-wrap gap-1.5 border-b border-border px-3 py-2">
        {[{ key: null as string | null, label: "All" }, ...tabs].map((t) => {
          const active = tab === t.key;
          return (
            <button
              type="button"
              key={t.key ?? "all"}
              onClick={() => setTab(t.key)}
              className={`rounded-full border px-3 py-1 text-xs transition-colors ${
                active
                  ? "border-foreground bg-foreground text-background"
                  : "border-border bg-background text-foreground hover:bg-accent"
              }`}
            >
              {t.label}
            </button>
          );
        })}
      </div>

      <div className="max-h-64 overflow-y-auto py-1">
        {groups.length === 0 ? (
          <p className="px-3 py-3 text-sm text-muted-foreground">{emptyMessage}</p>
        ) : (
          groups.map((group) => (
            <div key={group.key}>
              <p className="px-3 pb-1 pt-2 text-xs uppercase tracking-wide text-muted-foreground">
                {group.label} <span className="ml-1">{group.count}</span>
              </p>
              {group.rows}
            </div>
          ))
        )}
      </div>
    </div>
  );
}
