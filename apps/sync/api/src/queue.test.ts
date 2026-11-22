import { expect, test } from "bun:test";
import { fakeStore } from "./lib/fake-store.ts";
import { createQueue } from "./queue.ts";
import type { SyncAction } from "./sync/action.ts";

const tick = () => new Promise((resolve) => setTimeout(resolve, 1));
/** Names a job in tests; the queue never looks inside an action. */
const named = (name: string): SyncAction => ({ kind: "refs", refs: [name] });
const nameOf = (action: SyncAction) => (action.kind === "refs" ? (action.refs[0] ?? "") : action.kind);

function setup(jobs: Record<string, () => Promise<void>> = {}, opts: { concurrency?: number; leaseMs?: number } = {}) {
  const store = fakeStore();
  const ran: { syncId: string; name: string }[] = [];
  const errors: [string | null, unknown][] = [];
  const queue = createQueue({
    store,
    ...opts,
    run: async (syncId, action) => {
      ran.push({ syncId, name: nameOf(action) });
      await jobs[nameOf(action)]?.();
    },
    onError: (syncId, error) => errors.push([syncId, error]),
  });
  return { store, queue, ran, errors };
}

test("jobs on one sync run in order and never overlap", async () => {
  const log: string[] = [];
  let running = 0;
  const job = (name: string) => async () => {
    running++;
    expect(running).toBe(1);
    log.push(`start ${name}`);
    await tick();
    log.push(`end ${name}`);
    running--;
  };
  const { queue } = setup({ a: job("a"), b: job("b"), c: job("c") });
  for (const name of ["a", "b", "c"]) await queue.push("s1", named(name));
  await queue.idle();
  expect(log).toEqual(["start a", "end a", "start b", "end b", "start c", "end c"]);
});

test("jobs on two syncs run concurrently", async () => {
  let release: () => void = () => {};
  const blocked = new Promise<void>((resolve) => {
    release = resolve;
  });
  let otherRan = false;
  const { queue } = setup({
    blocked: () => blocked,
    other: async () => {
      otherRan = true;
      release();
    },
  });
  await queue.push("s1", named("blocked"));
  await queue.push("s2", named("other"));
  await queue.idle();
  expect(otherRan).toBe(true);
});

test("no more than `concurrency` jobs run at once", async () => {
  let running = 0;
  let most = 0;
  const job = async () => {
    most = Math.max(most, ++running);
    await tick();
    running--;
  };
  const { queue, ran } = setup({ a: job, b: job, c: job }, { concurrency: 2 });
  for (const [sync, name] of [["s1", "a"], ["s2", "b"], ["s3", "c"]] as const) await queue.push(sync, named(name));
  await queue.idle();
  expect(ran).toHaveLength(3);
  expect(most).toBe(2);
});

test("a throwing job is reported and dropped, and the next job still runs", async () => {
  let ran = false;
  const { queue, errors, store } = setup({
    boom: async () => {
      throw new Error("boom");
    },
    next: async () => {
      ran = true;
    },
  });
  await queue.push("s1", named("boom"));
  await queue.push("s1", named("next"));
  await queue.idle();
  expect(ran).toBe(true);
  expect(errors).toEqual([["s1", new Error("boom")]]);
  expect(store.jobs).toEqual([]);
});

test("idle resolves at once with nothing queued", async () => {
  await setup().queue.idle();
});

test("idle waits for jobs queued by jobs", async () => {
  let inner = false;
  const { queue } = setup({
    outer: async () => {
      await queue.push("s1", named("inner"));
    },
    inner: async () => {
      await tick();
      inner = true;
    },
  });
  await queue.push("s1", named("outer"));
  await queue.idle();
  expect(inner).toBe(true);
});

test("a started queue runs pushed jobs without being asked, until stopped", async () => {
  const { queue, ran } = setup();
  queue.start();
  await queue.push("s1", named("a"));
  while (ran.length === 0) await tick();
  await queue.stop();
  expect(ran).toEqual([{ syncId: "s1", name: "a" }]);
});

test("jobs stored before a restart are run by the next process", async () => {
  const { queue, ran, store } = setup();
  await store.enqueueJob("s1", named("left over"));
  await queue.idle();
  expect(ran).toEqual([{ syncId: "s1", name: "left over" }]);
});

test("a job running longer than its lease is not run again by another worker", async () => {
  const { queue, ran, store, errors } = setup({ slow: () => Bun.sleep(100) }, { leaseMs: 30 });
  const other = createQueue({ store, leaseMs: 30, run: async (syncId, action) => void ran.push({ syncId, name: nameOf(action) }), onError: () => {} });
  await queue.push("s1", named("slow"));
  await Promise.all([queue.idle(), (async () => {
    for (let i = 0; i < 10; i++) {
      await Bun.sleep(15);
      await other.idle();
    }
  })()]);
  expect(ran).toEqual([{ syncId: "s1", name: "slow" }]);
  expect(errors).toEqual([]);
});

test("a database failure is reported, and the queue keeps working once it recovers", async () => {
  const { queue, store, ran, errors } = setup();
  const claim = store.claimJob;
  store.claimJob = async () => {
    store.claimJob = claim;
    throw new Error("connection refused");
  };
  await queue.push("s1", named("a"));
  await queue.idle();
  expect(errors).toEqual([[null, new Error("connection refused")]]);
  await queue.idle();
  expect(ran).toEqual([{ syncId: "s1", name: "a" }]);
});
