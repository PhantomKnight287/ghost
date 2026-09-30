# 0031 — Outbound delivery is its own service, and Postgres is its queue

**Status:** adopted

## Decision

Anything that leaves the system over the network — thread emails today, webhooks next — is sent by `apps/delivery`, a separate process. The API decides what to send; delivery decides how to get it there.

Delivery happens in two stages:

1. **Fan-out, in the API.** `OutboxService` keeps claiming `outbox_event` rows ([0029](0029-events-go-through-an-outbox.md)), but instead of sending anything it works out who and what: recipients, access, mentions, subscribed endpoints. It renders email bodies, freezes webhook payloads and inserts one `delivery_job` per message. Inbox rows are still written here, since they are database writes, not deliveries.
2. **Delivery, in `apps/delivery`.** The service claims due jobs, sends them, and records every attempt. It never reads domain tables (issues, users, repositories); it reads only its own: `delivery_job`, `delivery_attempt` and `webhook_endpoint`.

A job is a finished message:

```ts
type DeliveryJob =
  | { kind: 'email'; idempotencyKey: string; to: string; subject: string; html: string; text: string; headers?: Record<string, string> }
  | { kind: 'webhook'; idempotencyKey: string; endpointId: string; event: string; body: string };
```

`idempotency_key` is unique, so a fan-out that runs twice enqueues once. A webhook body is frozen at fan-out, so a redelivery sends the same bytes.

The queue is the `delivery_job` table. A worker claims due jobs with `FOR UPDATE SKIP LOCKED`, sets a lease (`locked_until`) and commits before sending; no transaction is open during a network call. A job whose worker died is claimed again once its lease runs out. Every send has a whole-request deadline (connect, TLS, request and reading the capped response, 10 seconds), and the lease is longer than that deadline plus the time to record the attempt (60 seconds), so a live worker never loses its job mid-send. The claim also stamps a fresh claim token, and the worker records the outcome only where that token still matches, so a worker that overran its lease cannot overwrite the result of the worker that reclaimed the job. The caller runs `NOTIFY delivery` after inserting jobs so the service wakes at once; polling remains the fallback, so a missed notify costs latency, never a message.

Failures retry with exponential backoff and full jitter, capped, until the job is marked `dead`. A webhook is signed at send time, with HMAC-SHA256 over `timestamp.body`, so a late retry carries a fresh timestamp. The destination is checked for private, loopback, link-local and metadata addresses on the IP actually dialed, and redirects are not followed. Webhook requests never go through a proxy: the transport sets `Proxy` to `nil`, since Go's default transport honours `HTTP_PROXY`, and through a proxy the dialed IP is the proxy's, not the destination's.

The service is written in Go with `pgx`. Its tables and migrations stay in `packages/db`; the service never migrates. The job shape is declared in TypeScript and mirrored as a Go struct, and one shared JSON fixture is decoded by tests on both sides.

## Why

Delivery depends on things outside our control: mail relays, and customer endpoints that are slow, down or hostile. Isolating it means a flood of retries or a hanging endpoint cannot take memory, connections or event-loop time from the API, and it can be deployed, scaled and debugged alone.

Fan-out stays in the API because it needs the domain: permissions, subscriptions, templates. Doing it inside the request's transaction would make a comment on a repository with thousands of watchers write thousands of rows while the user waits, so it runs after the commit, from the outbox.

Rejected:

- **Redis pub/sub.** Messages published while no subscriber is listening are lost, and publishing after the database commit reintroduces the dual write the outbox exists to prevent. Redis Streams keeps messages but not the atomicity, and adds infrastructure. Postgres already holds the data and the transaction.
- **Holding the claim's transaction across the send**, as `OutboxService` does. One slow endpoint would pin row locks and a connection for its whole timeout.
- **Node for the service.** A Node process idles at several times the memory of a Go one, and the host bills for it. Go's `net.Dialer.Control` also sees the resolved IP at connect time, which closes DNS rebinding without a custom resolver.

## Consequences

- Delivery is at least once. Receivers deduplicate on the `X-Ghost-Delivery` header; emails can repeat if a worker dies after sending and before recording it.
- Ordering is not guaranteed, even per endpoint. Per-endpoint order would let one failing delivery hold back every later one.
- The repository has a second language, and the job shape is declared twice. The shared fixture is what keeps the two in step.
- The service must be able to read webhook secrets, so they are stored encrypted, not hashed.
- The queue's throughput is Postgres's. Past a few thousand jobs a second sustained, a dedicated queue fed from the outbox would replace the table; the contract would not change.
- Attempts accumulate until a pruning job exists.
