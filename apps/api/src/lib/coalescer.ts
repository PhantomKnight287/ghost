/** Runs work once per key at a time; a call while it runs queues exactly one rerun after it, so the last call's state always gets seen. */
export class Coalescer {
  private readonly running = new Map<string, Promise<void>>();
  private readonly rerun = new Set<string>();

  run(key: string, work: () => Promise<void>): Promise<void> {
    const running = this.running.get(key);
    if (running) {
      this.rerun.add(key);
      return running;
    }

    const run = (async () => {
      do {
        this.rerun.delete(key);
        await work();
      } while (this.rerun.has(key));
    })().finally(() => this.running.delete(key));
    this.running.set(key, run);
    return run;
  }

  isRunning(key: string) {
    return this.running.has(key);
  }

  /** Drops a queued rerun and resolves once the run in flight, if any, has finished. */
  async settle(key: string) {
    this.rerun.delete(key);
    await this.running.get(key)?.catch(() => undefined);
  }
}
