import pierreDark from "@pierre/theme/pierre-dark";
import pierreLight from "@pierre/theme/pierre-light";
import {
  bundledLanguages,
  codeToTokens,
  type BundledLanguage,
  type ThemeRegistrationRaw,
} from "shiki";

import { APP_THEMES } from "@/lib/themes";

// the pierre themes ship as frozen TextMate objects, which shiki loads and caches by their own `name`; the rest are bundled names. keys line up with the `--shiki-<id>` selectors in globals.css.
const THEMES = Object.fromEntries(
  APP_THEMES.map((t) => [
    t.id,
    t.id === "light"
      ? (pierreLight as ThemeRegistrationRaw)
      : t.id === "dark"
        ? (pierreDark as ThemeRegistrationRaw)
        : t.shiki,
  ]),
);

const LANGUAGE_BY_NAME: Record<string, BundledLanguage> = {
  dockerfile: "docker",
  makefile: "make",
  gemfile: "ruby",
  rakefile: "ruby",
};

function languageFor(filename: string): BundledLanguage | "text" {
  const name = filename.toLowerCase();
  if (name in LANGUAGE_BY_NAME) return LANGUAGE_BY_NAME[name];

  const extension = name.split(".").pop() ?? "";
  return extension in bundledLanguages
    ? (extension as BundledLanguage)
    : "text";
}

/** Tokens per line, coloured for every app theme at once. Render them inside `[data-shiki]`, which picks the active theme's colour. */
export async function highlightLines(code: string, filename: string) {
  const { tokens } = await codeToTokens(code, {
    lang: languageFor(filename),
    themes: THEMES,
    defaultColor: false,
  });
  return tokens;
}
