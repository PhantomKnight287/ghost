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

export function languageForPath(path: string): string | null {
  const filename = path.slice(path.lastIndexOf("/") + 1).toLowerCase();

  const named = BY_FILENAME[filename];
  if (named) return named;

  const dot = filename.lastIndexOf(".");
  if (dot <= 0) return null;

  return BY_EXTENSION[filename.slice(dot + 1)] ?? null;
}
