// Copies the templates GitHub serves at /gitignore/templates and /licenses, through `gh api` so the requests are authenticated and stay under the rate limit.
import { $ } from "bun";

const api = async (path: string) => JSON.parse(await $`gh api ${path}`.text());

const names: string[] = await api("/gitignore/templates");
const gitignore: Record<string, string> = {};
for (const name of names)
  gitignore[name] = (await api(`/gitignore/templates/${name}`)).source;

const listed: { key: string }[] = await api("/licenses");
const licenses = [];
for (const { key } of listed) {
  // `url` names api.github.com; Ghost answers its own.
  const { url: _url, ...license } = await api(`/licenses/${key}`);
  licenses.push(license);
}

const dir = new URL("../src/", import.meta.url);
await Bun.write(
  new URL("gitignore.json", dir),
  `${JSON.stringify(gitignore, null, 2)}\n`,
);
await Bun.write(
  new URL("licenses.json", dir),
  `${JSON.stringify(licenses, null, 2)}\n`,
);
