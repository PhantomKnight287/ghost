import pierreDark from "@pierre/theme/pierre-dark";
import pierreLight from "@pierre/theme/pierre-light";
import {
  createBundledHighlighter,
  createSingletonShorthands,
  guessEmbeddedLanguages,
  type ThemeRegistrationRaw,
} from "shiki/core";
import { createJavaScriptRegexEngine } from "shiki/engine/javascript";
import { bundledLanguages, type BundledLanguage } from "shiki/langs";
import { bundledThemes } from "shiki/themes";

import { APP_THEME_IDS, APP_THEMES } from "@/lib/themes";

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

// The JavaScript engine spares the browser the oniguruma wasm download. Its default target mis-tokenizes TypeScript in JavaScriptCore, so Safari would; ES2018 runs the same everywhere. `forgiving` skips the rare grammar pattern it cannot run instead of failing the whole highlight.
const { codeToTokens } = createSingletonShorthands(
  createBundledHighlighter({
    langs: bundledLanguages,
    themes: bundledThemes,
    engine: () =>
      createJavaScriptRegexEngine({ target: "ES2018", forgiving: true }),
  }),
  { guessEmbeddedLanguages },
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

/** Tokens per line, coloured for every theme in `themeIds` at once. Render them inside `[data-shiki]`, which picks the active theme's colour. */
export async function highlightLines(
  code: string,
  filename: string,
  themeIds = APP_THEME_IDS,
) {
  const { tokens } = await codeToTokens(code, {
    lang: languageFor(filename),
    themes: Object.fromEntries(themeIds.map((id) => [id, THEMES[id]])),
    defaultColor: false,
  });
  return tokens;
}
