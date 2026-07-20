"use client";

import { useEffect, useState } from "react";

/**
 * Simple localStorage-backed state hook. SSR-safe: returns `initial` on the
 * server and during first client render, then hydrates from localStorage.
 */
export function useLocalStorageState<T>(key: string, initial: T) {
  const [value, setValue] = useState<T>(initial);
  const [hydrated, setHydrated] = useState(false);

  useEffect(() => {
    try {
      const raw = window.localStorage.getItem(key);
      if (raw) setValue(JSON.parse(raw) as T);
    } catch {
      // Ignore corrupt localStorage values and keep the default.
    }
    setHydrated(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  useEffect(() => {
    if (!hydrated) return;
    try {
      window.localStorage.setItem(key, JSON.stringify(value));
    } catch {
      // Ignore quota/serialization errors — settings just won't persist.
    }
  }, [key, value, hydrated]);

  return [value, setValue] as const;
}

export function getOrCreateSafetyIdentifier(): string {
  if (typeof window === "undefined") return "";
  const key = "mintroom.safetyId";
  let id = window.localStorage.getItem(key);
  if (!id) {
    id = `mr_${crypto.randomUUID()}`;
    window.localStorage.setItem(key, id);
  }
  return id;
}
