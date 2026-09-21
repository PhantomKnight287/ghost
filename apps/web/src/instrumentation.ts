import { registerOTel } from "@vercel/otel";

export function register() {
  // Without a collector to ship to, the exporter retries against localhost on every request, so telemetry stays opt-in.
  if (!process.env.OTEL_EXPORTER_OTLP_ENDPOINT) return;
  registerOTel({ serviceName: "ghost-web" });
}
