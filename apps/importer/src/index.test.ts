import { expect, test } from "bun:test";

import type { Config } from "./config.ts";
import { createApp } from "./index.ts";
import type { Job } from "./import-job.ts";

const config: Config = {
  PORT: 0,
  IMPORTER_SECRET: "a-secret-long-enough",
  GHOST_API_URL: "http://api:3001",
  IMPORTER_CONCURRENCY: 1,
  IMPORTER_WORKDIR: "/tmp/unused",
};

const job: Job = {
  importId: "import_1",
  attempt: "4b0b6b8e-3c4f-4b77-9a4e-1c2d3e4f5a6b",
  source: "octo/repo",
  destination: "me/repo",
  githubToken: "gh",
  ghostToken: "ghost",
  lastAttempt: false,
};

function post(
  app: ReturnType<typeof createApp>,
  body: unknown,
  secret = config.IMPORTER_SECRET,
) {
  return app.request("/imports", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${secret}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });
}

test("refuses a wrong secret", async () => {
  const app = createApp(config, async () => {});
  expect((await post(app, job, "wrong")).status).toBe(401);
});

test("refuses a malformed job", async () => {
  const app = createApp(config, async () => {});
  expect((await post(app, { ...job, source: "not a repo" })).status).toBe(400);
  // the id names a directory under the workdir
  expect((await post(app, { ...job, importId: "../etc" })).status).toBe(400);
});

test("accepts a job, runs it, and turns jobs away while full", async () => {
  let finish = () => {};
  const started: Job[] = [];
  const app = createApp(config, (accepted) => {
    started.push(accepted);
    return new Promise((resolve) => {
      finish = resolve;
    });
  });

  expect((await post(app, job)).status).toBe(202);
  expect(started).toEqual([job]);
  expect(
    (
      await post(app, {
        ...job,
        attempt: "5b0b6b8e-3c4f-4b77-9a4e-1c2d3e4f5a6b",
      })
    ).status,
  ).toBe(503);

  finish();
  await Bun.sleep(0);
  expect((await post(app, job)).status).toBe(202);
});

test("runs one attempt of an import at a time, whatever the room", async () => {
  const app = createApp(
    { ...config, IMPORTER_CONCURRENCY: 2 },
    () => new Promise(() => {}),
  );
  const retry = { ...job, attempt: "5b0b6b8e-3c4f-4b77-9a4e-1c2d3e4f5a6b" };
  expect((await post(app, job)).status).toBe(202);
  expect((await post(app, retry)).status).toBe(503);
  expect((await post(app, { ...retry, importId: "import_2" })).status).toBe(
    202,
  );
});

test("health answers", async () => {
  expect(
    await (await createApp(config, async () => {}).request("/health")).text(),
  ).toBe("ok");
});
