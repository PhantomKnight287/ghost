import path from "node:path";

import { createMDX } from "fumadocs-mdx/next";
import type { NextConfig } from "next";

/** Pages that moved into section folders, so links to the old flat URLs keep working. */
const MOVED: [string, string][] = [
  ["/self-hosting-configuration", "/self-hosting/configuration"],
  ["/about-ssh", "/ssh"],
  ["/generating-an-ssh-key", "/ssh/generating-a-key"],
  ["/adding-an-ssh-key-to-your-account", "/ssh/adding-a-key"],
  ["/testing-your-ssh-connection", "/ssh/testing-your-connection"],
  ["/using-ssh-with-a-repository", "/ssh/using-with-a-repository"],
  ["/troubleshooting-ssh", "/ssh/troubleshooting"],
  ["/about-commit-signature-verification", "/signing"],
  ["/generating-a-gpg-key", "/signing/generating-a-gpg-key"],
  ["/adding-a-gpg-key-to-your-account", "/signing/adding-a-gpg-key"],
  ["/telling-git-about-your-key", "/signing/telling-git-about-your-key"],
  ["/signing-commits-and-tags", "/signing/signing-commits-and-tags"],
  ["/email-addresses-and-keys", "/signing/email-addresses-and-keys"],
  ["/expiration-and-revocation", "/signing/expiration-and-revocation"],
  ["/troubleshooting", "/signing/troubleshooting"],
  [
    "/checking-out-pull-requests-locally",
    "/pull-requests/checking-out-locally",
  ],
  ["/github-compatibility", "/github-cli"],
];

const nextConfig: NextConfig = {
  // Emits `.next/standalone` with only the server and its used dependencies.
  output: "standalone",
  // The app lives in a workspace, so tracing has to start at the repo root.
  outputFileTracingRoot: path.join(import.meta.dirname, "../.."),
  redirects: async () =>
    MOVED.map(([source, destination]) => ({
      source,
      destination,
      permanent: true,
    })),
};

export default createMDX()(nextConfig);
