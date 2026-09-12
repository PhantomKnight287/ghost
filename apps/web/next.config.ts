import path from "node:path";

import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  /* config options here */
  reactCompiler: true,
  // Emits `.next/standalone` with only the server and its used dependencies.
  output: "standalone",
  // The app lives in a workspace, so tracing has to start at the repo root.
  outputFileTracingRoot: path.join(import.meta.dirname, "../.."),
};

export default nextConfig;
