import { expect, test } from "bun:test";
import { loadConfig } from "./config.ts";
import { other, SIDE_NAME } from "./side.ts";

const valid = {
  SYNC_DATABASE_URL: "postgres://x",
  SYNC_AUTH_SECRET: "s".repeat(32),
  SYNC_API_URL: "https://sync-api.example.com",
  SYNC_WEB_URL: "https://sync.example.com",
  GHOST_API_URL: "https://api.example.com",
  GHOST_APP_ID: "7",
  GHOST_APP_SLUG: "ghost-sync",
  GHOST_APP_PRIVATE_KEY: "pem",
  GHOST_APP_CLIENT_ID: "c",
  GHOST_APP_CLIENT_SECRET: "s",
  GHOST_APP_WEBHOOK_SECRET: "w",
  GITHUB_APP_ID: "9",
  GITHUB_APP_SLUG: "ghost-sync",
  GITHUB_APP_PRIVATE_KEY: "pem",
  GITHUB_APP_CLIENT_ID: "c",
  GITHUB_APP_CLIENT_SECRET: "s",
  GITHUB_APP_WEBHOOK_SECRET: "w",
};

test("defaults", () => {
  const config = loadConfig(valid);
  expect(config.SYNC_PORT).toBe(3005);
  expect(config.RECONCILE_INTERVAL).toBe(600);
  expect(config.SYNC_DATA_DIR).toBe("/data");
  expect(config.GHOST_APP_ID).toBe(7);
  expect(config.GITHUB_APP_ID).toBe(9);
});

test("overrides", () => {
  const config = loadConfig({ ...valid, SYNC_PORT: "4000", RECONCILE_INTERVAL: "60", SYNC_DATA_DIR: "/tmp/sync" });
  expect(config.SYNC_PORT).toBe(4000);
  expect(config.RECONCILE_INTERVAL).toBe(60);
  expect(config.SYNC_DATA_DIR).toBe("/tmp/sync");
});

test("private keys accept \\n-escaped PEMs", () => {
  const config = loadConfig({ ...valid, GHOST_APP_PRIVATE_KEY: "a\\nb", GITHUB_APP_PRIVATE_KEY: "c\\nd" });
  expect(config.GHOST_APP_PRIVATE_KEY).toBe("a\nb");
  expect(config.GITHUB_APP_PRIVATE_KEY).toBe("c\nd");
});

test("a missing value names the variable", () => {
  const { GHOST_API_URL: _, ...rest } = valid;
  expect(() => loadConfig(rest)).toThrow(/GHOST_API_URL/);
});

test("a non-numeric app id is refused", () => {
  expect(() => loadConfig({ ...valid, GITHUB_APP_ID: "nine" })).toThrow(/GITHUB_APP_ID/);
});

test("sides", () => {
  expect(other("ghost")).toBe("github");
  expect(other("github")).toBe("ghost");
  expect(SIDE_NAME).toEqual({ ghost: "Ghost", github: "GitHub" });
});
