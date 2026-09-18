export type ThemeKind = "light" | "dark";

export type AppTheme = {
  id: string;
  name: string;
  kind: ThemeKind;
  blurb: string;
  /** [background, foreground, primary] swatch for the picker */
  swatches: [string, string, string];
  /** shiki theme name used for code highlighting (pierre for the defaults) */
  shiki: string;
};

export const APP_THEMES: AppTheme[] = [
  {
    id: "light",
    name: "Light",
    kind: "light",
    blurb: "Default light",
    swatches: ["#fafafa", "#1c1917", "#7c3aed"],
    shiki: "pierre-light",
  },
  {
    id: "dark",
    name: "Dark",
    kind: "dark",
    blurb: "Default dark",
    swatches: ["#14101f", "#f5f3ff", "#a78bfa"],
    shiki: "pierre-dark",
  },
  {
    id: "vesper",
    name: "Vesper",
    kind: "dark",
    blurb: "Warm near-black",
    swatches: ["#101010", "#ffffff", "#ffc799"],
    shiki: "vesper",
  },
  {
    id: "dracula",
    name: "Dracula",
    kind: "dark",
    blurb: "Classic purple",
    swatches: ["#282a36", "#f8f8f2", "#bd93f9"],
    shiki: "dracula",
  },
  {
    id: "tokyo-night",
    name: "Tokyo Night",
    kind: "dark",
    blurb: "Cool blue night",
    swatches: ["#1a1b26", "#c0caf5", "#7aa2f7"],
    shiki: "tokyo-night",
  },
  {
    id: "catppuccin",
    name: "Catppuccin Mocha",
    kind: "dark",
    blurb: "Pastel dark",
    swatches: ["#1e1e2e", "#cdd6f4", "#cba6f7"],
    shiki: "catppuccin-mocha",
  },
  {
    id: "nord",
    name: "Nord",
    kind: "dark",
    blurb: "Arctic calm",
    swatches: ["#2e3440", "#eceff4", "#88c0d0"],
    shiki: "nord",
  },
  {
    id: "one-dark-pro",
    name: "One Dark Pro",
    kind: "dark",
    blurb: "Atom classic",
    swatches: ["#282c34", "#abb2bf", "#61afef"],
    shiki: "one-dark-pro",
  },
  {
    id: "monokai",
    name: "Monokai",
    kind: "dark",
    blurb: "High-contrast pop",
    swatches: ["#272822", "#f8f8f2", "#a6e22e"],
    shiki: "monokai",
  },
  {
    id: "gruvbox",
    name: "Gruvbox",
    kind: "dark",
    blurb: "Retro groove",
    swatches: ["#282828", "#ebdbb2", "#fabd2f"],
    shiki: "gruvbox-dark-medium",
  },
  {
    id: "github-dark",
    name: "GitHub Dark",
    kind: "dark",
    blurb: "Dimmed GitHub",
    swatches: ["#0d1117", "#e6edf3", "#2f81f7"],
    shiki: "github-dark",
  },
  {
    id: "rose-pine",
    name: "Rosé Pine",
    kind: "dark",
    blurb: "Muted rose",
    swatches: ["#232136", "#e0def4", "#c4a7e7"],
    shiki: "rose-pine-moon",
  },
  {
    id: "custom",
    name: "Custom",
    kind: "dark",
    blurb: "Your colors",
    swatches: ["#18181b", "#fafafa", "#8b5cf6"],
    shiki: "github-dark",
  },
];

export const APP_THEME_IDS = APP_THEMES.map((t) => t.id);

const THEME_BY_ID = new Map(APP_THEMES.map((t) => [t.id, t]));

export function getAppTheme(id: string | undefined): AppTheme {
  if (id && THEME_BY_ID.has(id)) return THEME_BY_ID.get(id)!;
  return THEME_BY_ID.get("dark")!;
}

export function themeKind(
  id: string | undefined,
  customBase?: ThemeKind,
): ThemeKind {
  if (id === "custom") return customBase ?? "dark";
  return getAppTheme(id).kind;
}

/* ---------- custom theme persistence ---------- */

export type CustomThemeVars = {
  base: ThemeKind;
  background: string;
  foreground: string;
  primary: string;
  accent: string;
  radius: string;
};

export const CUSTOM_THEME_KEY = "ghost-custom-theme";

export const DEFAULT_CUSTOM_THEME: CustomThemeVars = {
  base: "dark",
  background: "#18181b",
  foreground: "#fafafa",
  primary: "#8b5cf6",
  accent: "#27272a",
  radius: "0.625rem",
};

export function loadCustomTheme(): CustomThemeVars {
  if (typeof window === "undefined") return DEFAULT_CUSTOM_THEME;
  try {
    const raw = window.localStorage.getItem(CUSTOM_THEME_KEY);
    if (!raw) return DEFAULT_CUSTOM_THEME;
    const parsed = JSON.parse(raw) as Partial<CustomThemeVars>;
    return {
      base: parsed.base === "light" ? "light" : "dark",
      background: validCssColor(parsed.background) ?? DEFAULT_CUSTOM_THEME.background,
      foreground: validCssColor(parsed.foreground) ?? DEFAULT_CUSTOM_THEME.foreground,
      primary: validCssColor(parsed.primary) ?? DEFAULT_CUSTOM_THEME.primary,
      accent: validCssColor(parsed.accent) ?? DEFAULT_CUSTOM_THEME.accent,
      radius: typeof parsed.radius === "string" && parsed.radius.trim() !== ""
        ? parsed.radius
        : DEFAULT_CUSTOM_THEME.radius,
    };
  } catch {
    return DEFAULT_CUSTOM_THEME;
  }
}

export function saveCustomTheme(vars: CustomThemeVars) {
  try {
    window.localStorage.setItem(CUSTOM_THEME_KEY, JSON.stringify(vars));
  } catch {
    /* storage full / blocked — theme just won't persist */
  }
}

function validCssColor(value: unknown): string | undefined {
  if (typeof value !== "string" || value.trim() === "") return undefined;
  if (typeof window === "undefined" || typeof Option === "undefined") return value;
  const el = new Option().style;
  el.color = value;
  return el.color === "" ? undefined : value;
}

/** Push custom-theme vars onto <html> as CSS variables. No-op on server. */
export function applyCustomThemeVars(vars: CustomThemeVars) {
  if (typeof document === "undefined") return;
  const root = document.documentElement;
  root.style.setProperty("--background", vars.background);
  root.style.setProperty("--foreground", vars.foreground);
  root.style.setProperty("--primary", vars.primary);
  root.style.setProperty("--accent", vars.accent);
  root.style.setProperty("--ring", vars.primary);
  root.style.setProperty("--radius", vars.radius);
}

export function clearCustomThemeVars() {
  if (typeof document === "undefined") return;
  const root = document.documentElement;
  for (const prop of [
    "--background",
    "--foreground",
    "--primary",
    "--accent",
    "--ring",
    "--radius",
  ]) {
    root.style.removeProperty(prop);
  }
}
