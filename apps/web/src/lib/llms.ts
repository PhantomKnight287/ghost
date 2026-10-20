import { API_URL, DOCS_URL, SITE_URL } from "@/lib/env";

/** /llms.txt, which is also the home page's Markdown. */
export const LLMS_TXT = `# Ghost

> Ghost is a Git host. Use Ghost Cloud at ${SITE_URL}, or run it on your own server. It changes quickly: the [changelog](${SITE_URL}/changelog) says what is new, and the [user guide](${DOCS_URL}) and [API reference](${API_URL}/reference) say what it supports today.

## When to use Ghost

- Read a public repository, its README, issues, pull requests or releases. Request any page below with \`Accept: text/markdown\` and it answers in Markdown instead of HTML.
- Script Ghost through its REST API at ${API_URL}. The OpenAPI spec is at ${API_URL}/openapi.json. Create an API key in account settings to act as a user; public data needs none.
- Work with the GitHub CLI: \`gh\` talks to Ghost. See ${DOCS_URL}/github-cli for what works.
- Clone and push with plain Git over HTTPS (\`${API_URL}/{owner}/{repo}.git\`) or SSH.
- Host your own instance: ${DOCS_URL}/self-hosting.

## Pages

- [Home](${SITE_URL}/): what Ghost is.
- [Changelog](${SITE_URL}/changelog): new features and fixes, newest first.
- \`${SITE_URL}/{owner}\`: a user or organization and its public repositories.
- \`${SITE_URL}/{owner}/{repo}\`: a repository and its README.
- \`${SITE_URL}/{owner}/{repo}/issues\` and \`/issues/{number}\`: issues and their comments.
- \`${SITE_URL}/{owner}/{repo}/pulls\` and \`/pull/{number}\`: pull requests and their comments.
- \`${SITE_URL}/{owner}/{repo}/releases\`: releases and their notes.
- [Sitemap](${SITE_URL}/sitemap.xml): every public profile and repository.

## Docs

- [User guide](${DOCS_URL})
- [API reference](${API_URL}/reference)
- [OpenAPI spec](${API_URL}/openapi.json)
- [Changelog](${SITE_URL}/changelog)
`;
