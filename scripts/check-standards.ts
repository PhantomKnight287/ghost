// Enforces the mechanical rules of docs/code-standards.md. Each error names the rule to read.
import { existsSync, readFileSync } from "node:fs";

process.chdir(`${import.meta.dir}/..`);

type Check = {
  rule: string;
  applies: (path: string) => boolean;
  find: (source: string) => number[];
};

const linesMatching = (source: string, pattern: RegExp) =>
  source.split("\n").flatMap((line, i) => (pattern.test(line) ? [i + 1] : []));

const checks: Check[] = [
  {
    rule: "3. Strings are never concatenated for layout",
    applies: () => true,
    find: (source) => linesMatching(source, /["'`]\s*\+\s*$/),
  },
  {
    rule: "5. No wrapped comments or strings",
    applies: () => true,
    find: (source) =>
      source.split("\n").flatMap((line, i, lines) => {
        const comment = /^\s*\/\/(?!\s*(biome|eslint|oxlint|@ts-))/;
        const wrappedLineComment =
          i > 0 && comment.test(line) && comment.test(lines[i - 1]);
        const wrappedJsxComment = line.includes("{/*") && !line.includes("*/}");
        return wrappedLineComment || wrappedJsxComment ? [i + 1] : [];
      }),
  },
  {
    rule: "6. `services/` holds services",
    applies: (path) =>
      path.includes("/services/") && !/\.(spec|test)\.ts$/.test(path),
    find: (source) => [
      ...(source.includes("@Injectable(") ? [] : [1]),
      ...linesMatching(source, /^export (async )?function |^export const /),
    ],
  },
  {
    rule: "6. Error classes live under `lib/`",
    applies: (path) =>
      path.startsWith("apps/api/src/") &&
      path.endsWith(".errors.ts") &&
      !path.startsWith("apps/api/src/lib/"),
    find: () => [1],
  },
  {
    rule: "7. Production quality is the default (no `any`)",
    applies: () => true,
    find: (source) =>
      linesMatching(source, /^(?!\s*(\/\/|\*)).*(:\s*any\b|\bas any\b|<any>)/),
  },
  {
    rule: "8. One file holds one component family (a page is not a family)",
    applies: (path) => /\/app\/(.*\/)?(page|layout)\.tsx$/.test(path),
    find: (source) => {
      const components = linesMatching(
        source,
        /^(export\s+)?(default\s+)?(async\s+)?function [A-Z]/,
      );
      return components.length > 1 ? components.slice(1) : [];
    },
  },
  {
    rule: "10. Every suspended boundary has a loading state",
    applies: (path) => path.endsWith(".tsx"),
    find: (source) => linesMatching(source, /fallback=\{null\}/),
  },
];

const files = Bun.spawnSync(["git", "ls-files", "*.ts", "*.tsx"])
  .stdout.toString()
  .trim()
  .split("\n")
  .filter(
    (path) =>
      !/(^|\/)(node_modules|drizzle|dist)\/|\/lib\/api\/v1\.d\.ts$|next-env\.d\.ts$|^scripts\/check-standards\.ts$/.test(
        path,
      ),
  );

const failures: string[] = [];
for (const path of files) {
  if (!existsSync(path)) continue;
  const source = readFileSync(path, "utf8");
  for (const check of checks) {
    if (!check.applies(path)) continue;
    failures.push(
      ...check
        .find(source)
        .map((line) => `${path}:${line} breaks rule ${check.rule}`),
    );
  }
}

if (failures.length > 0) {
  console.error(`${failures.join("\n")}\n\nSee docs/code-standards.md.`);
  process.exit(1);
}
