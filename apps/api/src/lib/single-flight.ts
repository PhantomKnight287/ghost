/** Runs work once per key at a time: a caller arriving while it runs shares that run's promise. */
export class SingleFlight<T> {
  private readonly running = new Map<string, Promise<T>>();

  run(key: string, work: () => Promise<T>): Promise<T> {
    const pending = this.running.get(key);
    if (pending) return pending;

    const run = work().finally(() => this.running.delete(key));
    this.running.set(key, run);
    return run;
  }

  /** Resolves once the run in flight for `key`, if any, has finished, whatever its outcome. */
  async settle(key: string) {
    await this.running.get(key)?.catch(() => undefined);
  }
}
