import { getNodeAutoInstrumentations } from '@opentelemetry/auto-instrumentations-node';
import { NodeSDK } from '@opentelemetry/sdk-node';
import Pyroscope from '@pyroscope/nodejs';

// Without a collector to ship to, the SDK retries against localhost and fills the log with export failures, so telemetry stays opt-in.
if (process.env.OTEL_EXPORTER_OTLP_ENDPOINT) {
  const sdk = new NodeSDK({
    serviceName: 'ghost-api',
    instrumentations: [
      getNodeAutoInstrumentations({
        // Every pack operation reads thousands of files; a span each buries the request they belong to.
        '@opentelemetry/instrumentation-fs': { enabled: false },
      }),
    ],
  });
  sdk.start();
  // Containers stop on SIGTERM; without a flush the last batch of spans and the last collection of metrics die with the process.
  process.once('SIGTERM', () => void sdk.shutdown());
}

// Profiling ships to Pyroscope directly: it is a push protocol of its own, not OTLP.
if (process.env.PYROSCOPE_SERVER_ADDRESS) {
  Pyroscope.init({
    appName: 'ghost-api',
    serverAddress: process.env.PYROSCOPE_SERVER_ADDRESS,
    // Wall time alone cannot tell a request blocked on postgres from one burning CPU.
    wall: { collectCpuTime: true },
  });
  Pyroscope.start();
}
