import { expect, test } from "bun:test";

import { loadConfig } from "./config.ts";

test("fills defaults", () => {
  const config = loadConfig({
    IMPORTER_SECRET: "a-secret-long-enough",
    GHOST_API_URL: "http://api:3001",
  });
  expect(config.PORT).toBe(3004);
  expect(config.IMPORTER_CONCURRENCY).toBe(2);
});

test("names what is missing", () => {
  expect(() => loadConfig({})).toThrow(/IMPORTER_SECRET/);
});
