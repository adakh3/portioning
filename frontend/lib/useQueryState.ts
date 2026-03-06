"use client";

import { useSearchParams, useRouter, usePathname } from "next/navigation";
import { useCallback, useEffect, useRef } from "react";

function getSessionStorage(key: string): string | null {
  try {
    return sessionStorage.getItem(key);
  } catch {
    return null;
  }
}

function setSessionStorage(key: string, value: string): void {
  try {
    sessionStorage.setItem(key, value);
  } catch {}
}

function removeSessionStorage(key: string): void {
  try {
    sessionStorage.removeItem(key);
  } catch {}
}

export function useQueryState(
  key: string,
  defaultValue: string
): [string, (value: string) => void] {
  const searchParams = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();
  const storageKey = `qs:${pathname}:${key}`;
  const restored = useRef(false);

  const urlValue = searchParams.get(key);
  const storedValue = typeof window !== "undefined" ? getSessionStorage(storageKey) : null;
  const value = urlValue ?? storedValue ?? defaultValue;

  // On mount: if URL is clean but sessionStorage has a non-default value, restore it to URL
  useEffect(() => {
    if (restored.current) return;
    restored.current = true;

    const stored = getSessionStorage(storageKey);
    if (!searchParams.has(key) && stored && stored !== defaultValue) {
      const params = new URLSearchParams(searchParams.toString());
      params.set(key, stored);
      const qs = params.toString();
      router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false });
    }
  }, [storageKey, key, defaultValue, searchParams, pathname, router]);

  const setValue = useCallback(
    (newValue: string) => {
      const params = new URLSearchParams(searchParams.toString());
      if (newValue === defaultValue) {
        params.delete(key);
        removeSessionStorage(storageKey);
      } else {
        params.set(key, newValue);
        setSessionStorage(storageKey, newValue);
      }
      const qs = params.toString();
      router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false });
    },
    [searchParams, key, defaultValue, pathname, router, storageKey]
  );

  // Keep sessionStorage in sync when URL param is present (e.g. shared URL)
  useEffect(() => {
    if (urlValue && urlValue !== defaultValue) {
      setSessionStorage(storageKey, urlValue);
    }
  }, [urlValue, defaultValue, storageKey]);

  return [value, setValue];
}

/**
 * Clear multiple query-state keys in a single URL update.
 * Avoids the stale-searchParams race when calling multiple setters sequentially.
 */
export function useClearQueryState(keys: string[]) {
  const searchParams = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();

  return useCallback(() => {
    const params = new URLSearchParams(searchParams.toString());
    for (const key of keys) {
      params.delete(key);
      removeSessionStorage(`qs:${pathname}:${key}`);
    }
    const qs = params.toString();
    router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false });
  }, [searchParams, keys, pathname, router]);
}
