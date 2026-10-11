import path from "node:path";

import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  /* config options here */
  reactCompiler: true,
  // Emits `.next/standalone` with only the server and its used dependencies.
  output: "standalone",
  // The app lives in a workspace, so tracing has to start at the repo root.
  outputFileTracingRoot: path.join(import.meta.dirname, "../.."),
  // A pull request lives at `pull/<n>`, as on GitHub; links from before the move used `pulls/<n>`.
  async redirects() {
    return [
      {
        source: "/:username/:repo/pulls/:number(\\d+)/:rest*",
        destination: "/:username/:repo/pull/:number/:rest*",
        permanent: true,
      },
    ];
  },
};

export default nextConfig;
