import gitignore from "./gitignore.json" with { type: "json" };
import licenses from "./licenses.json" with { type: "json" };

export type License = {
  key: string;
  name: string;
  spdx_id: string;
  node_id: string;
  html_url: string;
  description: string;
  implementation: string;
  permissions: string[];
  conditions: string[];
  limitations: string[];
  body: string;
  featured: boolean;
};

/** github/gitignore as GitHub serves it at /gitignore/templates, keyed by the name `gitignore_template` takes. Copied by `bun run update`. */
export const GITIGNORE_TEMPLATES: Record<string, string> = gitignore;

/** The licenses GitHub lists at /licenses, which `license_template` takes by key. Copied by `bun run update`. */
export const LICENSES: License[] = licenses;

/** The .gitignore template a name means, ignoring case as `--gitignore go` and `--gitignore Go` both mean Go. */
export function findGitignoreTemplate(name: string) {
  const wanted = name.toLowerCase();
  const found = Object.keys(GITIGNORE_TEMPLATES).find(
    (candidate) => candidate.toLowerCase() === wanted,
  );
  return found === undefined
    ? undefined
    : { name: found, source: GITIGNORE_TEMPLATES[found]! };
}

/** The license a key means, ignoring case: `MIT` is `mit`. */
export function findLicense(key: string) {
  return LICENSES.find((license) => license.key === key.toLowerCase());
}

/** A license's text with the holder and year filled in, as GitHub writes it; texts without the placeholders come back as they are. */
export function fillLicense(license: License, fullname: string, year: number) {
  return license.body
    .replaceAll("[year]", String(year))
    .replaceAll("[fullname]", fullname);
}
