import {
  languageForAlias,
  languageForPath,
  languageType,
} from "./language-for-path.js";
import { DOCUMENTATION, GENERATED, VENDORED } from "./linguist-paths.js";

/** The `.gitattributes` keys that override what counts, as GitHub's Linguist reads them. */
export const LINGUIST_ATTRIBUTES = [
  "linguist-vendored",
  "linguist-generated",
  "linguist-documentation",
  "linguist-detectable",
  "linguist-language",
] as const;

/** Values as `git check-attr` prints them: "set", "unset", "unspecified" or the assigned string. */
export type LinguistAttributes = Partial<
  Record<(typeof LINGUIST_ATTRIBUTES)[number], string>
>;

const anyOf = (patterns: string[]) =>
  new RegExp(patterns.map((pattern) => `(?:${pattern})`).join("|"));

const IS_VENDORED = anyOf(VENDORED);
const IS_DOCUMENTATION = anyOf(DOCUMENTATION);
const IS_GENERATED = anyOf(GENERATED);

/**
 * The language a file adds its bytes to in the repository's stats, or null when it adds none.
 *
 * Mirrors Linguist's `include_in_language_stats?`: vendored, documentation and generated files are left out, and of the rest only programming and markup languages count. Each rule can be overridden per path from `.gitattributes`.
 */
export function statsLanguage(
  path: string,
  attributes: LinguistAttributes = {},
): string | null {
  if (flag(attributes["linguist-vendored"]) ?? IS_VENDORED.test(path))
    return null;
  if (flag(attributes["linguist-documentation"]) ?? IS_DOCUMENTATION.test(path))
    return null;
  if (flag(attributes["linguist-generated"]) ?? IS_GENERATED.test(path))
    return null;

  const named = attributes["linguist-language"];
  const language =
    named === undefined || ["set", "unset", "unspecified"].includes(named)
      ? languageForPath(path)
      : languageForAlias(named);
  if (!language) return null;

  const detectable =
    flag(attributes["linguist-detectable"]) ??
    ["programming", "markup"].includes(languageType(language) ?? "");
  return detectable ? language : null;
}

/** Linguist's `boolean_attribute`: anything set counts as true except the string "false". */
function flag(value: string | undefined): boolean | undefined {
  if (value === undefined || value === "unspecified") return undefined;
  return value !== "unset" && value !== "false";
}
