// Fails when a lesson links to a file, symbol or ADR the repository no longer has, so lessons cannot drift silently from the code.
import { existsSync, globSync, readFileSync, statSync } from "node:fs";
import path from "node:path";

const app = path.resolve(import.meta.dirname, "..");
const root = path.resolve(app, "../..");
const lessons = globSync("content/learn/**/*.mdx", { cwd: app });

const problems: string[] = [];
let checked = 0;
for (const lesson of lessons) {
  const text = readFileSync(path.join(app, lesson), "utf8");
  for (const [, file, symbol] of text.matchAll(
    /<Source path="([^"]+)"(?: symbol="([^"]+)")?/g,
  )) {
    checked++;
    const target = path.join(root, file!);
    if (!existsSync(target)) problems.push(`${lesson}: ${file} does not exist`);
    else if (
      symbol &&
      statSync(target).isFile() &&
      !readFileSync(target, "utf8").includes(symbol)
    )
      problems.push(`${lesson}: ${file} no longer mentions ${symbol}`);
  }
  for (const [, adr] of text.matchAll(/<Adr file="([^"]+)"/g)) {
    checked++;
    if (!existsSync(path.join(root, "docs", `${adr}.md`)))
      problems.push(`${lesson}: docs/${adr}.md does not exist`);
  }
}

if (problems.length > 0) {
  console.error(problems.join("\n"));
  process.exit(1);
}
console.log(`${checked} links to the repository resolve`);
