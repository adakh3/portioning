import { describe, it, expect, vi, afterEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { useState, useEffect } from "react";

/**
 * Test the debounce pattern used in the leads page search.
 * This mirrors the exact pattern from app/leads/page.tsx:
 *   const [search, setSearch] = useState("");
 *   const [debouncedSearch, setDebouncedSearch] = useState("");
 *   useEffect(() => {
 *     const t = setTimeout(() => setDebouncedSearch(search), 300);
 *     return () => clearTimeout(t);
 *   }, [search]);
 */
function useSearchWithDebounce() {
  const [search, setSearch] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");

  useEffect(() => {
    const t = setTimeout(() => setDebouncedSearch(search), 300);
    return () => clearTimeout(t);
  }, [search]);

  return { search, setSearch, debouncedSearch };
}

describe("search debounce pattern", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("debounced value starts empty", () => {
    const { result } = renderHook(() => useSearchWithDebounce());
    expect(result.current.debouncedSearch).toBe("");
  });

  it("does not update debounced value immediately", () => {
    vi.useFakeTimers();
    const { result } = renderHook(() => useSearchWithDebounce());

    act(() => result.current.setSearch("alice"));
    expect(result.current.search).toBe("alice");
    expect(result.current.debouncedSearch).toBe("");
  });

  it("updates debounced value after 300ms", () => {
    vi.useFakeTimers();
    const { result } = renderHook(() => useSearchWithDebounce());

    act(() => result.current.setSearch("alice"));
    act(() => vi.advanceTimersByTime(300));

    expect(result.current.debouncedSearch).toBe("alice");
  });

  it("resets timer on rapid typing", () => {
    vi.useFakeTimers();
    const { result } = renderHook(() => useSearchWithDebounce());

    act(() => result.current.setSearch("a"));
    act(() => vi.advanceTimersByTime(200));
    act(() => result.current.setSearch("al"));
    act(() => vi.advanceTimersByTime(200));
    act(() => result.current.setSearch("ali"));

    // Only 200ms since last change — should still be empty
    expect(result.current.debouncedSearch).toBe("");

    act(() => vi.advanceTimersByTime(300));
    // Now the final value should propagate
    expect(result.current.debouncedSearch).toBe("ali");
  });

  it("clears debounced value when search is cleared", () => {
    vi.useFakeTimers();
    const { result } = renderHook(() => useSearchWithDebounce());

    act(() => result.current.setSearch("test"));
    act(() => vi.advanceTimersByTime(300));
    expect(result.current.debouncedSearch).toBe("test");

    act(() => result.current.setSearch(""));
    act(() => vi.advanceTimersByTime(300));
    expect(result.current.debouncedSearch).toBe("");
  });
});
