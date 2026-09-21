# Observability

Both apps speak OpenTelemetry. `compose.yaml` runs `grafana/otel-lgtm`, one container holding the OTLP collector, Prometheus, Tempo, Pyroscope, Loki and Grafana.

- Grafana: http://localhost:3100, user `GRAFANA_USER`, password `GRAFANA_PASSWORD`. Anonymous access and sign-up are off.
- OTLP: `http://lgtm:4318` inside the compose network, `http://localhost:4318` from the host
- Pyroscope: `http://lgtm:4040`, `http://localhost:4040` from the host

`GRAFANA_PASSWORD` has no default: compose refuses to start without it. Grafana only reads it when it creates the admin user, so changing it later needs the reset below, or a new volume.

```sh
docker compose exec lgtm sh -c 'cd /otel-lgtm/grafana && ./bin/grafana cli --homepath . --configOverrides cfg:default.paths.data=/data/grafana/data admin reset-admin-password "$GF_SECURITY_ADMIN_PASSWORD"'
```

Five wrong passwords in five minutes locks the account for five minutes, and the message stays "Invalid username or password" throughout. Wait it out rather than trying a sixth.

Nothing is exported until `OTEL_EXPORTER_OTLP_ENDPOINT` is set, and nothing is profiled until `PYROSCOPE_SERVER_ADDRESS` is: without a collector listening, the exporters retry and bury the logs. `.env.example` points both at the container, so `cp .env.example .env` plus `docker compose up -d lgtm` is enough for `bun run dev` on the host; compose sets them for the `api` and `web` services and holds both back until the collector is healthy.

## What is collected

`apps/api/src/instrumentation.ts` starts the Node SDK before Nest loads, so the auto-instrumentations patch `http`, `express`, `pg` and the AWS SDK: traces plus the `http.server.request.duration` histogram, which carries the matched route. Filesystem spans are off — a pack operation reads thousands of files and would bury the request it belongs to. The SDK is flushed on `SIGTERM`, so a redeploy does not drop the last batch.

`apps/web/src/instrumentation.ts` is Next.js's own instrumentation hook, registering the same exporter for server-side renders, route handlers and outbound `fetch`.

Tempo's metrics generator turns every span into `traces_spanmetrics_*`, so latency percentiles and error rates exist for both services without either of them emitting metrics of their own.

## Application metrics

`apps/api/src/lib/metrics.ts` holds the counters. They are recorded in `PushTransactionService.commitPush`, the single point every accepted push passes through, so a push counts once and a retried CAS attempt does not count twice.

| Metric | Prometheus name |
| --- | --- |
| `ghost.pushes` | `ghost_pushes_total` |
| `ghost.push.bytes` | `ghost_push_bytes_total` |
| `ghost.ref.updates` | `ghost_ref_updates_total` |

`AppStatsService` observes instance totals once per collection: `ghost_repositories` (by visibility), `ghost_commits`, `ghost_users`, `ghost_issues` (by state), `ghost_pull_requests` (by state), `ghost_stars`. These are counts, not histories — deleting a repository lowers the line, and a force push that drops commits lowers `ghost_commits`.

A meter taken before the SDK starts is a no-op for the life of the process, which is why `instrumentation.ts` is the first import in `main.ts`. In tests there is no SDK, so the instruments record nothing and nothing has to be stubbed.

## Profiling

`@pyroscope/nodejs` pushes wall, CPU and heap profiles from the API. It is a push protocol of its own, not OTLP, hence its own switch. Profiles flush once a minute, so a process that lives less than that uploads nothing.

Only the API is profiled. `@pyroscope/nodejs` ships a native module that the Next.js standalone build would have to carry, and the web server's own cost already shows up in its traces.

## Dashboard

`grafana/ghost.json` is provisioned as the home dashboard, `grafana/dashboards.yaml` is the provider that loads it. Request rate, error rate, p50/p90/p99, slowest endpoints, outbound calls, traces over 500ms, the API's CPU and wall flame graphs, then an application row: totals, commits over time, repositories by visibility, pushed bytes and pushes.

A frame that is wide in the wall graph but narrow in the CPU one is waiting on postgres, S3 or git rather than computing.

The browser is not instrumented — these are server-side numbers. Real user monitoring needs a Faro receiver, which this container does not run.
