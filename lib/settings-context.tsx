"use client";

import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import { DEFAULT_SETTINGS, type AppSettings } from "./types";
import { getOrCreateSafetyIdentifier, useLocalStorageState } from "./use-local-storage";

const SETTINGS_KEY = "mintroom.settings";

interface SettingsContextValue {
  settings: AppSettings;
  setSettings: (updater: (prev: AppSettings) => AppSettings) => void;
  resetSettings: () => void;
}

const initialSettings: AppSettings = { ...DEFAULT_SETTINGS, safety: { ...DEFAULT_SETTINGS.safety, safetyIdentifier: "" } };

const SettingsContext = createContext<SettingsContextValue | null>(null);

export function SettingsProvider({ children }: { children: ReactNode }) {
  const [settings, setSettingsRaw] = useLocalStorageState<AppSettings>(SETTINGS_KEY, initialSettings);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    const safetyIdentifier = getOrCreateSafetyIdentifier();
    setSettingsRaw((prev) =>
      prev.safety.safetyIdentifier ? prev : { ...prev, safety: { ...prev.safety, safetyIdentifier } }
    );
    setReady(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const root = document.documentElement;
    const apply = (isDark: boolean) => root.classList.toggle("dark", isDark);
    if (settings.appearance.theme === "system") {
      const mql = window.matchMedia("(prefers-color-scheme: dark)");
      apply(mql.matches);
      const listener = (e: MediaQueryListEvent) => apply(e.matches);
      mql.addEventListener("change", listener);
      return () => mql.removeEventListener("change", listener);
    }
    apply(settings.appearance.theme === "dark");
  }, [settings.appearance.theme]);

  const setSettings = (updater: (prev: AppSettings) => AppSettings) => setSettingsRaw(updater);
  const resetSettings = () =>
    setSettingsRaw((prev) => ({ ...initialSettings, safety: { ...initialSettings.safety, safetyIdentifier: prev.safety.safetyIdentifier } }));

  if (!ready) return null;

  return (
    <SettingsContext.Provider value={{ settings, setSettings, resetSettings }}>{children}</SettingsContext.Provider>
  );
}

export function useSettings(): SettingsContextValue {
  const ctx = useContext(SettingsContext);
  if (!ctx) throw new Error("useSettings must be used within SettingsProvider");
  return ctx;
}
