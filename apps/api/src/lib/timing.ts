import { AsyncLocalStorage } from 'node:async_hooks';

interface Span {
  label: string;
  depth: number;
  /** ms after the trace began. */
  start: number;
  /** Unset while the step is still running, as a background task can be when the trace reports. */
  ms?: number;
}

interface Trace {
  spans: Span[];
  origin: number;
}

const current = new AsyncLocalStorage<{ trace: Trace; depth: number }>();

/** Times `work` as a step of the trace in progress. Outside a trace it only runs it, so shared code can be timed for one route without cost to the others. */
export function timed<T>(label: string, work: () => Promise<T>): Promise<T> {
  const context = current.getStore();
  if (!context) return work();

  const { trace, depth } = context;
  const span: Span = {
    label,
    depth,
    start: performance.now() - trace.origin,
  };
  trace.spans.push(span);
  return current.run({ trace, depth: depth + 1 }, work).finally(() => {
    span.ms = performance.now() - trace.origin - span.start;
  });
}

/** Runs `work` collecting every {@link timed} step under it, then hands `report` the steps as an indented tree: start offset, then duration. */
export async function traced<T>(
  work: () => Promise<T>,
  report: (tree: string) => void,
): Promise<T> {
  const trace: Trace = { spans: [], origin: performance.now() };
  try {
    return await current.run({ trace, depth: 0 }, work);
  } finally {
    const ms = (value: number) => `${Math.round(value)}ms`;
    report(
      [
        `total ${ms(performance.now() - trace.origin)}`,
        ...trace.spans.map(
          ({ label, depth, start, ms: took }) =>
            `${'  '.repeat(depth + 1)}${label} @${ms(start)} ${took === undefined ? 'still running' : ms(took)}`,
        ),
      ].join('\n'),
    );
  }
}
