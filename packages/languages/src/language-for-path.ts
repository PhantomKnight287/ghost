const BY_EXTENSION: Record<string, string> = {
  ts: "TypeScript",
  tsx: "TypeScript",
  mts: "TypeScript",
  cts: "TypeScript",
  js: "JavaScript",
  jsx: "JavaScript",
  mjs: "JavaScript",
  cjs: "JavaScript",
  py: "Python",
  rb: "Ruby",
  go: "Go",
  rs: "Rust",
  java: "Java",
  kt: "Kotlin",
  kts: "Kotlin",
  swift: "Swift",
  c: "C",
  h: "C",
  cc: "C++",
  cpp: "C++",
  cxx: "C++",
  hpp: "C++",
  hh: "C++",
  cs: "C#",
  php: "PHP",
  scala: "Scala",
  clj: "Clojure",
  ex: "Elixir",
  exs: "Elixir",
  erl: "Erlang",
  hs: "Haskell",
  lua: "Lua",
  pl: "Perl",
  r: "R",
  dart: "Dart",
  zig: "Zig",
  sql: "SQL",
  sh: "Shell",
  bash: "Shell",
  zsh: "Shell",
  fish: "Shell",
  ps1: "PowerShell",
  html: "HTML",
  htm: "HTML",
  css: "CSS",
  scss: "SCSS",
  sass: "SCSS",
  less: "Less",
  vue: "Vue",
  svelte: "Svelte",
  astro: "Astro",
  md: "Markdown",
  mdx: "MDX",
  json: "JSON",
  yml: "YAML",
  yaml: "YAML",
  toml: "TOML",
  xml: "XML",
  proto: "Protocol Buffer",
  graphql: "GraphQL",
  gql: "GraphQL",
  tf: "HCL",
  hcl: "HCL",
  nix: "Nix",
  vim: "Vim Script",
  ipynb: "Jupyter Notebook",
};

const BY_FILENAME: Record<string, string> = {
  dockerfile: "Dockerfile",
  makefile: "Makefile",
  "cmakelists.txt": "CMake",
  rakefile: "Ruby",
  gemfile: "Ruby",
  justfile: "Just",
};

export type LanguageType = "programming" | "markup" | "data" | "prose";

/** Linguist's type and aliases for every language above (lib/linguist/languages.yml). */
const LANGUAGES: Record<string, { type: LanguageType; aliases?: string[] }> = {
  TypeScript: { type: "programming", aliases: ["ts"] },
  JavaScript: { type: "programming", aliases: ["js", "node"] },
  Python: { type: "programming", aliases: ["py", "py3", "python3", "rusthon"] },
  Ruby: {
    type: "programming",
    aliases: ["jruby", "macruby", "rake", "rb", "rbx"],
  },
  Go: { type: "programming", aliases: ["golang"] },
  Rust: { type: "programming", aliases: ["rs"] },
  Java: { type: "programming" },
  Kotlin: { type: "programming" },
  Swift: { type: "programming" },
  C: { type: "programming" },
  "C++": { type: "programming", aliases: ["cpp"] },
  "C#": { type: "programming", aliases: ["csharp", "cake", "cakescript"] },
  PHP: { type: "programming", aliases: ["inc"] },
  Scala: { type: "programming" },
  Clojure: { type: "programming" },
  Elixir: { type: "programming" },
  Erlang: { type: "programming" },
  Haskell: { type: "programming" },
  Lua: { type: "programming" },
  Perl: { type: "programming", aliases: ["cperl"] },
  R: { type: "programming", aliases: ["rscript", "splus"] },
  Dart: { type: "programming" },
  Zig: { type: "programming" },
  SQL: { type: "data" },
  Shell: {
    type: "programming",
    aliases: ["sh", "shell-script", "bash", "zsh", "envrc"],
  },
  PowerShell: { type: "programming", aliases: ["posh", "pwsh"] },
  HTML: { type: "markup", aliases: ["xhtml"] },
  CSS: { type: "markup" },
  SCSS: { type: "markup" },
  Less: { type: "markup", aliases: ["less-css"] },
  Vue: { type: "markup" },
  Svelte: { type: "markup" },
  Astro: { type: "markup" },
  Markdown: { type: "prose", aliases: ["md", "pandoc"] },
  MDX: { type: "markup" },
  JSON: { type: "data", aliases: ["geojson", "jsonl", "sarif", "topojson"] },
  YAML: { type: "data", aliases: ["yml"] },
  TOML: { type: "data" },
  XML: { type: "data", aliases: ["rss", "xsd", "wsdl"] },
  "Protocol Buffer": {
    type: "data",
    aliases: ["proto", "protobuf", "protocol buffers"],
  },
  GraphQL: { type: "data" },
  HCL: {
    type: "programming",
    aliases: ["hashicorp configuration language", "opentofu", "terraform"],
  },
  Nix: { type: "programming", aliases: ["nixos"] },
  "Vim Script": {
    type: "programming",
    aliases: ["vim", "viml", "nvim", "vimscript"],
  },
  "Jupyter Notebook": { type: "markup", aliases: ["ipython notebook"] },
  Dockerfile: { type: "programming", aliases: ["containerfile"] },
  Makefile: { type: "programming", aliases: ["bsdmake", "make", "mf"] },
  CMake: { type: "programming" },
  Just: { type: "programming", aliases: ["justfile"] },
};

const BY_ALIAS = new Map<string, string>();
for (const [name, { aliases = [] }] of Object.entries(LANGUAGES)) {
  BY_ALIAS.set(name.toLowerCase(), name);
  BY_ALIAS.set(name.toLowerCase().replace(/\s/g, "-"), name);
  for (const alias of aliases) BY_ALIAS.set(alias, name);
}

export function languageType(language: string): LanguageType | null {
  return LANGUAGES[language]?.type ?? null;
}

/** A language by its name or one of its aliases, ignoring case, as `linguist-language` names it. */
export function languageForAlias(alias: string): string | null {
  return BY_ALIAS.get(alias.toLowerCase()) ?? null;
}

export function languageForPath(path: string): string | null {
  const filename = path.slice(path.lastIndexOf("/") + 1).toLowerCase();

  const named = BY_FILENAME[filename];
  if (named) return named;

  const dot = filename.lastIndexOf(".");
  if (dot <= 0) return null;

  return BY_EXTENSION[filename.slice(dot + 1)] ?? null;
}
