"use client";

import { Check, Monitor, Moon, Palette, Sun } from "lucide-react";
import { useTheme } from "next-themes";
import { useState, useSyncExternalStore } from "react";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  CUSTOM_THEME_UPDATED_EVENT,
  useCustomTheme,
} from "@/components/theme-effects";
import {
  APP_THEMES,
  DEFAULT_CUSTOM_THEME,
  loadCustomTheme,
  saveCustomTheme,
  type CustomThemeVars,
} from "@/lib/themes";
import { cn } from "@/lib/utils";

function Swatch({ colors }: { colors: [string, string, string] }) {
  return (
    <span className="flex -space-x-1" aria-hidden>
      {colors.map((c) => (
        <span
          key={c}
          className="size-4 rounded-full border border-black/20"
          style={{ backgroundColor: c }}
        />
      ))}
    </span>
  );
}

function useMounted() {
  return useSyncExternalStore(
    () => () => {},
    () => true,
    () => false,
  );
}

export function ThemePicker({ align = "end" }: { align?: "start" | "end" | "center" }) {
  const { theme, setTheme } = useTheme();
  const mounted = useMounted();
  const [customOpen, setCustomOpen] = useState(false);
  const { custom } = useCustomTheme();

  const active = mounted ? (theme ?? "system") : "system";
  const activeDef = APP_THEMES.find((t) => t.id === active);

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="ghost" size="icon" aria-label="Change theme">
            {mounted && activeDef ? (
              <span
                className="size-4 rounded-full border border-black/20"
                style={{ backgroundColor: activeDef.swatches[2] }}
              />
            ) : (
              <Palette />
            )}
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align={align} className="w-64">
          <DropdownMenuLabel>Theme</DropdownMenuLabel>
          <DropdownMenuItem onClick={() => setTheme("system")}>
            <Monitor className="text-muted-foreground" />
            <span className="flex-1">System</span>
            {active === "system" && <Check className="ml-auto" />}
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          {APP_THEMES.map((t) => (
            <DropdownMenuItem
              key={t.id}
              onClick={() => setTheme(t.id)}
              className={cn(t.id === "custom" && "mt-0")}
            >
              <Swatch
                colors={
                  t.id === "custom" && mounted
                    ? [custom.background, custom.foreground, custom.primary]
                    : t.swatches
                }
              />
              <span className="flex-1">
                {t.name}
                <span className="block text-xs text-muted-foreground">
                  {t.id === "custom" ? "Your colors" : t.blurb}
                </span>
              </span>
              {active === t.id && <Check className="ml-auto shrink-0" />}
            </DropdownMenuItem>
          ))}
          <DropdownMenuSeparator />
          <DropdownMenuItem
            onSelect={(e) => {
              e.preventDefault();
              setCustomOpen(true);
            }}
          >
            <Palette className="text-muted-foreground" />
            <span className="flex-1">Customize custom theme…</span>
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
      <CustomThemeDialog open={customOpen} onOpenChange={setCustomOpen} />
    </>
  );
}

const COLOR_FIELDS = [
  { key: "background", label: "Background" },
  { key: "foreground", label: "Foreground" },
  { key: "primary", label: "Primary" },
  { key: "accent", label: "Accent" },
] as const;

function CustomThemeDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const { setTheme } = useTheme();
  const [draft, setDraft] = useState<CustomThemeVars>(DEFAULT_CUSTOM_THEME);

  const handleOpenChange = (next: boolean) => {
    if (next) setDraft(loadCustomTheme());
    onOpenChange(next);
  };

  const set = <K extends keyof CustomThemeVars>(key: K, value: CustomThemeVars[K]) =>
    setDraft((d) => ({ ...d, [key]: value }));

  const save = () => {
    saveCustomTheme(draft);
    window.dispatchEvent(new Event(CUSTOM_THEME_UPDATED_EVENT));
    setTheme("custom");
    onOpenChange(false);
  };

  const reset = () => setDraft(DEFAULT_CUSTOM_THEME);

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Custom theme</DialogTitle>
          <DialogDescription>
            Pick your own colors. They are stored in this browser and applied
            whenever the Custom theme is active.
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-col gap-4">
          <div className="flex flex-col gap-2">
            <Label>Base</Label>
            <div className="grid grid-cols-2 gap-2">
              <Button
                type="button"
                variant={draft.base === "light" ? "default" : "outline"}
                size="sm"
                onClick={() => set("base", "light")}
              >
                <Sun data-icon="inline-start" />
                Light
              </Button>
              <Button
                type="button"
                variant={draft.base === "dark" ? "default" : "outline"}
                size="sm"
                onClick={() => set("base", "dark")}
              >
                <Moon data-icon="inline-start" />
                Dark
              </Button>
            </div>
            <p className="text-xs text-muted-foreground">
              Base decides code highlighting, toasts and dark-mode utilities.
            </p>
          </div>

          <div className="grid grid-cols-2 gap-3">
            {COLOR_FIELDS.map(({ key, label }) => (
              <div key={key} className="flex flex-col gap-1.5">
                <Label htmlFor={`custom-${key}`}>{label}</Label>
                <div className="flex items-center gap-2">
                  <input
                    id={`custom-${key}-picker`}
                    type="color"
                    aria-label={`${label} color picker`}
                    value={toColorInputValue(draft[key])}
                    onChange={(e) => set(key, e.target.value)}
                    className="h-9 w-10 shrink-0 cursor-pointer rounded-md border bg-transparent p-1"
                  />
                  <Input
                    id={`custom-${key}`}
                    value={draft[key]}
                    onChange={(e) => set(key, e.target.value)}
                    spellCheck={false}
                    className="font-mono text-xs"
                  />
                </div>
              </div>
            ))}
          </div>

          {/* live preview */}
          <div
            className="overflow-hidden rounded-lg border"
            style={{ backgroundColor: draft.background, color: draft.foreground }}
          >
            <div className="flex items-center gap-2 px-3 py-2 text-sm font-medium">
              <span
                className="size-2.5 rounded-full"
                style={{ backgroundColor: draft.primary }}
              />
              Preview
            </div>
            <div className="flex items-center gap-2 px-3 pb-3">
              <span
                className="rounded-md px-2.5 py-1 text-xs font-medium"
                style={{ backgroundColor: draft.primary, color: draft.background }}
              >
                Primary button
              </span>
              <span
                className="rounded-md px-2.5 py-1 text-xs"
                style={{ backgroundColor: draft.accent, color: draft.foreground }}
              >
                Accent chip
              </span>
            </div>
          </div>
        </div>

        <DialogFooter>
          <Button type="button" variant="ghost" onClick={reset}>
            Reset
          </Button>
          <Button type="button" onClick={save}>
            Save & apply
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/** <input type="color"> needs #rrggbb; fall back to black for named colors. */
function toColorInputValue(value: string): string {
  if (/^#[0-9a-fA-F]{6}$/.test(value)) return value;
  const m = /^#[0-9a-fA-F]{3}$/.exec(value);
  if (m) {
    const [r, g, b] = value.slice(1).split("");
    return `#${r}${r}${g}${g}${b}${b}`;
  }
  return "#000000";
}
