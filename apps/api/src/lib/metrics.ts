import { metrics } from '@opentelemetry/api';

/** The global meter provider is registered by `instrumentation.ts` before Nest loads: a meter taken before that is a no-op for the life of the process. */
export const meter = metrics.getMeter('ghost');

export const pushesTotal = meter.createCounter('ghost.pushes', {
  description: 'Pushes accepted into the write-ahead log.',
});

export const pushBytesTotal = meter.createCounter('ghost.push.bytes', {
  unit: 'By',
  description: 'Packfile bytes accepted into the write-ahead log.',
});

export const refUpdatesTotal = meter.createCounter('ghost.ref.updates', {
  description: 'Ref transitions applied by accepted pushes.',
});
