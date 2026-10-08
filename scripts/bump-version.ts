// Sets one version on the root and every apps/* package.json, so a single tag names a release. Usage: bun scripts/bump-version.ts <major|minor|patch|x.y.z>
import { readdirSync, readFileSync, writeFileSync } from "node:fs";

const SEMVER = /^(\d+)\.(\d+)\.(\d+)$/;
const VERSION_FIELD = /("version":\s*")[^"]*(")/;

export function nextVersion(current: string, bump: string) {
  if (SEMVER.test(bump)) return bump;
  const match = SEMVER.exec(current);
  if (!match) throw new Error(`Root version "${current}" is not x.y.z`);
  const [major, minor, patch] = match.slice(1).map(Number);
  if (bump === "major") return `${major + 1}.0.0`;
  if (bump === "minor") return `${major}.${minor + 1}.0`;
  if (bump === "patch") return `${major}.${minor}.${patch + 1}`;
  throw new Error(`Expected major, minor, patch or x.y.z, got "${bump}"`);
}

if (import.meta.main) {
  process.chdir(`${import.meta.dir}/..`);

  const files = [
    "package.json",
    ...readdirSync("apps", { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => `apps/${entry.name}/package.json`)
      .filter((file) => {
        try {
          return VERSION_FIELD.test(readFileSync(file, "utf8"));
        } catch {
          return false;
        }
      }),
  ];

  const current = JSON.parse(readFileSync("package.json", "utf8")).version;
  const version = nextVersion(current, process.argv[2] ?? "");

  // a field edit rather than JSON.stringify, so each file keeps its own formatting
  for (const file of files) {
    writeFileSync(
      file,
      readFileSync(file, "utf8").replace(VERSION_FIELD, `$1${version}$2`),
    );
  }

  console.log(
    `${current} -> ${version}\n${files.map((file) => `  ${file}`).join("\n")}`,
  );
  console.log(
    `Next: add a changelog entry, commit "release: ${version}", then tag v${version}.`,
  );
}
