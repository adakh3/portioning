"use client";

import { useEffect, useRef, useState } from "react";
import { api, PricingPreview } from "./api";

/** How long after the last keystroke to ask the server. Long enough that typing
 * "150" is one request, short enough that the card doesn't feel behind. */
export const PREVIEW_DEBOUNCE_MS = 300;

export interface PricingPreviewState {
  /** The last GOOD result. Never null once one has arrived — see `isStale`. */
  result: PricingPreview | null;
  /** True while what's shown no longer matches what's been typed: a request is in
   * flight, or the last one failed. The card dims rather than blanking. */
  isStale: boolean;
  /** Set when the last attempt failed and `result` is therefore out of date. */
  error: string | null;
  /** Ask now, without waiting out the debounce — for blur and discrete actions
   * (a toggle, adding a line, picking from the catalog), where the user has
   * finished deciding and expects the number to move. */
  flush: () => void;
}

/**
 * Server-priced totals for a draft booking.
 *
 * The frontend used to compute these itself, and the two implementations drifted
 * — a tax rate read as a fraction on one screen and a percentage on another, four
 * copies of the same conversion. What this returns IS what a save would store.
 *
 * The contract, which the tests pin:
 *
 * * **debounced** — typing `150` fires once, not three times;
 * * **latest-wins** — a newer request aborts the one in flight, so a slow early
 *   response can never overwrite a fresh late one;
 * * **never blank** — the previous result stays on screen while the next is
 *   fetched, marked stale, because a totals card that empties while you type
 *   reads as "your booking is worth nothing";
 * * **keep-last-good** — a failed request leaves the numbers alone and reports the
 *   error, rather than replacing money with a spinner.
 *
 * Pass `draft = null` to disable (view mode, or before the form is ready).
 */
export function usePricingPreview(draft: unknown | null): PricingPreviewState {
  const [result, setResult] = useState<PricingPreview | null>(null);
  const [isStale, setIsStale] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // The serialized draft is the dependency, not the object: a re-render that
  // rebuilds an identical draft must not re-fetch.
  const key = draft === null ? null : JSON.stringify(draft);

  const inFlight = useRef<AbortController | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Read inside the timer so a fire always sends the CURRENT draft, never the one
  // captured when the timer was set.
  const latest = useRef<string | null>(key);
  latest.current = key;

  const run = useRef(async (payload: string) => {
    inFlight.current?.abort();
    const controller = new AbortController();
    inFlight.current = controller;
    setIsStale(true);
    try {
      const next = await api.pricingPreview(JSON.parse(payload), controller.signal);
      // A response from a request we've already superseded must not land: it is
      // older information wearing a newer timestamp.
      if (controller.signal.aborted) return;
      setResult(next);
      setError(null);
      setIsStale(false);
    } catch (e) {
      if (controller.signal.aborted || (e as Error)?.name === "AbortError") return;
      // Keep the last good numbers. They are stale, and we say so, but they are
      // the last true thing we knew.
      setError(e instanceof Error ? e.message : "Totals will refresh shortly");
      setIsStale(true);
    }
  });

  useEffect(() => {
    if (key === null) return;
    if (timer.current) clearTimeout(timer.current);
    setIsStale(true);
    timer.current = setTimeout(() => {
      if (latest.current !== null) run.current(latest.current);
    }, PREVIEW_DEBOUNCE_MS);
    return () => {
      if (timer.current) clearTimeout(timer.current);
    };
  }, [key]);

  // Abort whatever is in flight when the page goes away, so a late response can't
  // set state on an unmounted component.
  useEffect(() => () => inFlight.current?.abort(), []);

  const flush = useRef(() => {
    if (timer.current) clearTimeout(timer.current);
    if (latest.current !== null) run.current(latest.current);
  });

  return { result, isStale, error, flush: flush.current };
}
