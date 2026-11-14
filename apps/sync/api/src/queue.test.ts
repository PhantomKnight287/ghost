import { expect, test } from "bun:test";
import { createQueues } from "./queue.ts";

const tick = () => new Promise((resolve) => setTimeout(resolve, 1));

test("jobs on one sync run in order and never overlap", async () => {
  const queues = createQueues(() => {});
  const log: string[] = [];
  let running = 0;
  for (const name of ["a", "b", "c"]) {
    queues.push("s1", async () => {
      running++;
      expect(running).toBe(1);
      log.push(`start ${name}`);
      await tick();
      log.push(`end ${name}`);
      running--;
    });
  }
  await queues.idle();
  expect(log).toEqual(["start a", "end a", "start b", "end b", "start c", "end c"]);
});

test("jobs on two syncs run concurrently", async () => {
  const queues = createQueues(() => {});
  let release: () => void = () => {};
  const blocked = new Promise<void>((resolve) => {
    release = resolve;
  });
  let otherRan = false;
  queues.push("s1", () => blocked);
  queues.push("s2", async () => {
    otherRan = true;
    release();
  });
  await queues.idle();
  expect(otherRan).toBe(true);
});

test("a throwing job reports and the next job still runs", async () => {
  const errors: [string, unknown][] = [];
  const queues = createQueues((syncId, error) => errors.push([syncId, error]));
  let ran = false;
  queues.push("s1", async () => {
    throw new Error("boom");
  });
  queues.push("s1", async () => {
    ran = true;
  });
  await queues.idle();
  expect(ran).toBe(true);
  expect(errors).toHaveLength(1);
  expect(errors[0]?.[0]).toBe("s1");
});

test("idle resolves at once with nothing queued", async () => {
  await createQueues(() => {}).idle();
});

test("idle waits for jobs queued by jobs", async () => {
  const queues = createQueues(() => {});
  let inner = false;
  queues.push("s1", async () => {
    queues.push("s1", async () => {
      await tick();
      inner = true;
    });
  });
  await queues.idle();
  expect(inner).toBe(true);
});
