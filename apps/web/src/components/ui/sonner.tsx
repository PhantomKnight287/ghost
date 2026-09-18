"use client";

import { useTheme } from "next-themes";
import { useSyncExternalStore } from "react";
import { Toaster as Sonner, type ToasterProps } from "sonner";
import {
  CircleCheckIcon,
  InfoIcon,
  TriangleAlertIcon,
  OctagonXIcon,
  Loader2Icon,
} from "lucide-react";

import { getAppTheme } from "@/lib/themes";

function subscribeToCustomTheme(onChange: () => void) {
  const onStorage = (e: StorageEvent) => {
    if (e.key === "ghost-custom-theme") onChange();
  };
  window.addEventListener("storage", onStorage);
  window.addEventListener("ghost-custom-theme-changed", onChange);
  return () => {
    window.removeEventListener("storage", onStorage);
    window.removeEventListener("ghost-custom-theme-changed", onChange);
  };
}

function getCustomThemeBase(): "light" | "dark" {
  try {
    const raw = window.localStorage.getItem("ghost-custom-theme");
    if (raw) {
      const parsed = JSON.parse(raw) as { base?: unknown };
      return parsed.base === "light" ? "light" : "dark";
    }
  } catch {
    /* keep default */
  }
  return "dark";
}

const Toaster = ({ ...props }: ToasterProps) => {
  const { theme, systemTheme } = useTheme();
  const customBase = useSyncExternalStore(
    subscribeToCustomTheme,
    getCustomThemeBase,
    () => "dark" as const,
  );

  const resolved = theme === "system" ? systemTheme : theme;
  let sonnerTheme: ToasterProps["theme"] = "system";
  if (resolved === "light" || resolved === "dark") sonnerTheme = resolved;
  else if (resolved === "custom") sonnerTheme = customBase;
  else if (resolved) sonnerTheme = getAppTheme(resolved).kind;

  return (
    <Sonner
      theme={sonnerTheme}
      className="toaster group"
      icons={{
        success: <CircleCheckIcon className="size-4" />,
        info: <InfoIcon className="size-4" />,
        warning: <TriangleAlertIcon className="size-4" />,
        error: <OctagonXIcon className="size-4" />,
        loading: <Loader2Icon className="size-4 animate-spin" />,
      }}
      style={
        {
          "--normal-bg": "var(--popover)",
          "--normal-text": "var(--popover-foreground)",
          "--normal-border": "var(--border)",
          "--border-radius": "var(--radius)",
        } as React.CSSProperties
      }
      toastOptions={{
        classNames: {
          toast: "cn-toast",
        },
      }}
      {...props}
    />
  );
};

export { Toaster };
