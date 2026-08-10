import { act, renderHook, waitFor } from "@testing-library/react";
import { api } from "./api";
import { PREVIEW_DEBOUNCE_MS, usePricingPreview } from "./usePricingPreview";

/**
 * The preview hook's contract is entirely about TIMING and ORDERING — debounce,
 * abort, keep-last-good — which is exactly the part that cannot be verified by
 * looking at it. Each test here is one clause of the docstring.
 */

const reply = (total: string) => ({
  food: { menu_food: "0.00", food_rows: null, meal_rows: [], meals_food: "0.00", food_total: "0.00" },
  lines: { items: [], add_ons_subtotal: "0.00" },
  totals: {
    subtotal: total, charge_base: total, service_charge: "0.00",
    pre_tax_total: total, tax_base: total, tax_amount: "0.00",
    gratuity: "0.00", total,
  },
  rates: { tax_rate: "0", service_charge_pct: "0", service_charge_taxable: true, gratuity_pct: "0" },
  warnings: [],
});

describe("usePricingPreview", () => {
  beforeEach(() => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    vi.restoreAllMocks();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("debounces: typing 150 one digit at a time asks the server once", async () => {
    const spy = vi.spyOn(api, "pricingPreview").mockResolvedValue(reply("150.00"));
    const { rerender } = renderHook(({ d }) => usePricingPreview(d), {
      initialProps: { d: { guest_count: 1 } as unknown },
    });

    rerender({ d: { guest_count: 15 } });
    rerender({ d: { guest_count: 150 } });
    // Mid-flight: nothing has been asked yet.
    expect(spy).not.toHaveBeenCalled();

    await act(async () => {
      vi.advanceTimersByTime(PREVIEW_DEBOUNCE_MS + 10);
    });

    expect(spy).toHaveBeenCalledTimes(1);
    // And it asked with the LAST value typed, not the first.
    expect(spy.mock.calls[0][0]).toEqual({ guest_count: 150 });
  });

  it("flush() asks immediately, without waiting out the debounce", async () => {
    const spy = vi.spyOn(api, "pricingPreview").mockResolvedValue(reply("10.00"));
    const { result } = renderHook(() => usePricingPreview({ guest_count: 5 }));

    await act(async () => {
      result.current.flush();
    });

    expect(spy).toHaveBeenCalledTimes(1);
  });

  it("latest wins: a slow first response cannot overwrite a fast second", async () => {
    // The first request never resolves until we let it, and by then it has been
    // aborted — the shape of a genuinely slow network.
    let releaseFirst: (v: unknown) => void = () => {};
    const first = new Promise((r) => { releaseFirst = r; });
    const spy = vi.spyOn(api, "pricingPreview").mockImplementation((_draft: unknown, signal?: AbortSignal) => {
      if (spy.mock.calls.length === 1) {
        return first.then(() => {
          if (signal?.aborted) throw Object.assign(new Error("aborted"), { name: "AbortError" });
          return reply("111.00");
        }) as Promise<ReturnType<typeof reply>>;
      }
      return Promise.resolve(reply("222.00"));
    });

    const { result, rerender } = renderHook(({ d }) => usePricingPreview(d), {
      initialProps: { d: { guest_count: 1 } as unknown },
    });
    await act(async () => { vi.advanceTimersByTime(PREVIEW_DEBOUNCE_MS + 10); });

    rerender({ d: { guest_count: 2 } });
    await act(async () => { vi.advanceTimersByTime(PREVIEW_DEBOUNCE_MS + 10); });

    // Now let the stale first response land. It must be ignored.
    await act(async () => { releaseFirst(null); });

    await waitFor(() => expect(result.current.result?.totals.total).toBe("222.00"));
    expect(result.current.result?.totals.total).not.toBe("111.00");
  });

  it("keeps the last good numbers when a request fails, and says they are stale", async () => {
    const spy = vi.spyOn(api, "pricingPreview").mockResolvedValueOnce(reply("500.00"));
    const { result, rerender } = renderHook(({ d }) => usePricingPreview(d), {
      initialProps: { d: { guest_count: 1 } as unknown },
    });
    await act(async () => { vi.advanceTimersByTime(PREVIEW_DEBOUNCE_MS + 10); });
    await waitFor(() => expect(result.current.result?.totals.total).toBe("500.00"));

    spy.mockRejectedValueOnce(new Error("Network down"));
    rerender({ d: { guest_count: 2 } });
    await act(async () => { vi.advanceTimersByTime(PREVIEW_DEBOUNCE_MS + 10); });

    await waitFor(() => expect(result.current.error).toBe("Network down"));
    // The money is still on screen — never blanked.
    expect(result.current.result?.totals.total).toBe("500.00");
    expect(result.current.isStale).toBe(true);
  });

  it("does not ask again when a re-render rebuilds an identical draft", async () => {
    const spy = vi.spyOn(api, "pricingPreview").mockResolvedValue(reply("1.00"));
    const { rerender } = renderHook(({ d }) => usePricingPreview(d), {
      initialProps: { d: { guest_count: 10, price_per_head: "5" } as unknown },
    });
    await act(async () => { vi.advanceTimersByTime(PREVIEW_DEBOUNCE_MS + 10); });
    expect(spy).toHaveBeenCalledTimes(1);

    // A new object, same content — the identity changed, the draft did not.
    rerender({ d: { guest_count: 10, price_per_head: "5" } });
    await act(async () => { vi.advanceTimersByTime(PREVIEW_DEBOUNCE_MS + 10); });

    expect(spy).toHaveBeenCalledTimes(1);
  });

  it("asks nothing at all when disabled (view mode)", async () => {
    const spy = vi.spyOn(api, "pricingPreview").mockResolvedValue(reply("1.00"));
    renderHook(() => usePricingPreview(null));

    await act(async () => { vi.advanceTimersByTime(PREVIEW_DEBOUNCE_MS + 50); });

    expect(spy).not.toHaveBeenCalled();
  });

  it("surfaces the backend's warnings alongside the numbers", async () => {
    vi.spyOn(api, "pricingPreview").mockResolvedValue({
      ...reply("49950.00"),
      warnings: ["The breakdown (999) is more than the guest count (10)."],
    });
    const { result } = renderHook(() => usePricingPreview({ guest_count: 10 }));

    await act(async () => { vi.advanceTimersByTime(PREVIEW_DEBOUNCE_MS + 10); });

    await waitFor(() => expect(result.current.result?.warnings).toHaveLength(1));
    // The figures are still there — a refusable draft is still priced.
    expect(result.current.result?.totals.total).toBe("49950.00");
  });
});
