"use client";

import { useTheme } from "next-themes";
import { useEffect, useState } from "react";

import {
  applyCustomThemeVars,
  clearCustomThemeVars,
  CUSTOM_THEME_KEY,
  DEFAULT_CUSTOM_THEME,
  loadCustomTheme,
  themeKind,
  type CustomThemeVars,
} from "@/lib/themes";

export const CUSTOM_THEME_UPDATED_EVENT = "ghost-custom-theme-changed";

export function useCustomTheme() {
  const [custom, setCustom] = useState<CustomThemeVars>(DEFAULT_CUSTOM_THEME);
  const [hydrated, setHydrated] = useState(false);

  useEffect(() => {
    // hydration-safe: localStorage only exists in the browser, so the stored
    // custom theme has to be synced after mount.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setCustom(loadCustomTheme());
    setHydrated(true);
  }, []);

  useEffect(() => {
    const reload = () => setCustom(loadCustomTheme());
    const onStorage = (e: StorageEvent) => {
      if (e.key === CUSTOM_THEME_KEY) reload();
    };
    window.addEventListener("storage", onStorage);
    window.addEventListener(CUSTOM_THEME_UPDATED_EVENT, reload);
    return () => {
      window.removeEventListener("storage", onStorage);
      window.removeEventListener(CUSTOM_THEME_UPDATED_EVENT, reload);
    };
  }, []);

  return { custom, hydrated };
}

/** Keeps Tailwind `dark:` utilities working for every dark-kind theme by mirroring the `dark` class, and applies user custom-theme variables. */
export function ThemeEffects() {
  const { theme, resolvedTheme } = useTheme();
  const { custom } = useCustomTheme();

  useEffect(() => {
    const active = theme === "system" ? resolvedTheme : theme;
    const kind = themeKind(active, custom.base);
    const root = document.documentElement;

    if (active === "custom") {
      applyCustomThemeVars(custom);
    } else {
      clearCustomThemeVars();
    }

    // next-themes owns the theme class itself; we only mirror `dark` so `dark:` variants keep working on dark-kind themes like vesper.
    if (active !== "dark" && active !== "light") {
      if (kind === "dark") root.classList.add("dark");
      else root.classList.remove("dark");
    }
  }, [theme, resolvedTheme, custom]);

  return null;
}

export function useActiveThemeKind() {
  const { theme, resolvedTheme } = useTheme();
  const { custom } = useCustomTheme();
  const active = theme === "system" ? resolvedTheme : theme;
  return themeKind(active, custom.base);
}
