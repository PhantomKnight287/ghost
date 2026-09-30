# Receiving webhooks

Ghost POSTs JSON to each webhook URL when one of the events it subscribes to happens. This page covers what a delivery looks like and how a receiver checks that it came from Ghost.

## Headers

| Header | Value |
|---|---|
| `Content-Type` | `application/json` |
| `User-Agent` | `Ghost-Hookshot/1` |
| `X-Ghost-Event` | The event, such as `issue.opened`, or `ping` for the test delivery |
| `X-Ghost-Delivery` | A UUID for this delivery. A retry keeps it; a manual redelivery gets a new one. |
| `X-Ghost-Timestamp` | When this attempt was signed, in Unix seconds |
| `X-Ghost-Signature-256` | `sha256=` and the hex HMAC-SHA256 of `<timestamp>.<body>` |
| `X-Hub-Signature-256` | `sha256=` and the hex HMAC-SHA256 of the body alone, the way GitHub signs |

Both signatures use the endpoint's signing secret, the `whsec_…` value shown once when the webhook is created.

## Verifying a delivery

Check `X-Ghost-Signature-256`:

1. Read the raw request body as bytes. Do not parse the JSON and serialize it again: the signature covers the exact bytes Ghost sent, and a round trip through a JSON parser changes them.
2. Read `X-Ghost-Timestamp` and reject the delivery if it is more than five minutes from your clock. The timestamp is inside the signed data, so a delivery captured by someone else cannot be replayed later with a fresh one.
3. Compute HMAC-SHA256 with the signing secret as the key over the timestamp, a `.`, and the raw body. Hex-encode it and put `sha256=` in front.
4. Compare the result with the header in constant time. An ordinary `==` returns sooner the earlier the strings differ, which lets an attacker guess a signature one character at a time.
5. Deduplicate on `X-Ghost-Delivery`. Delivery is at least once: a delivery your server handled but did not answer in time is sent again.

Reply with any 2xx status within 10 seconds, and do slow work after replying.

### Node.js

```ts
import { createHmac, timingSafeEqual } from 'node:crypto';

const TOLERANCE_SECONDS = 5 * 60;

export function verifyGhostWebhook(
  secret: string,
  rawBody: Buffer,
  timestamp: string | undefined,
  signature: string | undefined,
): boolean {
  if (!timestamp || !signature) return false;
  if (Math.abs(Date.now() / 1000 - Number(timestamp)) > TOLERANCE_SECONDS) return false;

  const expected = `sha256=${createHmac('sha256', secret).update(`${timestamp}.`).update(rawBody).digest('hex')}`;
  const a = Buffer.from(expected);
  const b = Buffer.from(signature);
  return a.length === b.length && timingSafeEqual(a, b);
}
```

With Express, keep the raw body by parsing it with `express.raw`:

```ts
app.post('/webhook', express.raw({ type: 'application/json' }), (req, res) => {
  const ok = verifyGhostWebhook(
    process.env.GHOST_WEBHOOK_SECRET!,
    req.body,
    req.get('X-Ghost-Timestamp'),
    req.get('X-Ghost-Signature-256'),
  );
  if (!ok) return res.sendStatus(401);
  res.sendStatus(204);
  handle(req.get('X-Ghost-Event'), JSON.parse(req.body.toString('utf8')));
});
```

`timingSafeEqual` throws when the two buffers differ in length, so compare the lengths first.

### Python

```python
import hashlib
import hmac
import time

TOLERANCE_SECONDS = 5 * 60


def verify_ghost_webhook(secret: str, raw_body: bytes, timestamp: str | None, signature: str | None) -> bool:
    if not timestamp or not signature:
        return False
    try:
        if abs(time.time() - int(timestamp)) > TOLERANCE_SECONDS:
            return False
    except ValueError:
        return False
    digest = hmac.new(secret.encode(), timestamp.encode() + b"." + raw_body, hashlib.sha256).hexdigest()
    return hmac.compare_digest(f"sha256={digest}", signature)
```

In Flask the raw body is `request.get_data()`; in Django it is `request.body`.

### Go

```go
func VerifyGhostWebhook(secret, rawBody []byte, timestamp, signature string) bool {
	ts, err := strconv.ParseInt(timestamp, 10, 64)
	if err != nil || math.Abs(time.Since(time.Unix(ts, 0)).Seconds()) > 5*60 {
		return false
	}
	mac := hmac.New(sha256.New, secret)
	mac.Write([]byte(timestamp + "."))
	mac.Write(rawBody)
	expected := "sha256=" + hex.EncodeToString(mac.Sum(nil))
	return hmac.Equal([]byte(expected), []byte(signature))
}
```

### Receivers written for GitHub

A receiver or library that already checks GitHub's `X-Hub-Signature-256` works unchanged with the same secret. That signature covers the body only, so it gives no replay protection: prefer `X-Ghost-Signature-256` when you write the check yourself.

## Retries

- A 2xx response is a success.
- A 410 Gone turns the webhook off.
- A 429 is retried after its `Retry-After`.
- Anything else, including a timeout, a redirect or a connection error, is retried with exponential backoff and jitter, at most an hour apart, for three days. After that the delivery is marked failed and can be redelivered from the webhook's page.
- A webhook whose deliveries all failed for three days is turned off, and the repository's or organization's admins get an email.

Ghost does not follow redirects, and it refuses URLs that resolve to private or reserved addresses.

## Chat services

A URL that is a Slack, Discord, Google Chat or Microsoft Teams incoming webhook gets a message in that service's own format instead of Ghost's JSON. It is sent as the Ghost app, with its name and logo where the service allows that. These services do not check signatures; the headers above are sent anyway.
