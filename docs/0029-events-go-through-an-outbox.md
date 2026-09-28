# 0029 — Repository events go through an outbox, and notifications are its first consumer

**Status:** adopted

## Decision

A change that someone may want to hear about writes an `outbox_event` row with `publishEvent`, in the same transaction as the change. The row names its type (`issue.opened`, `issue.commented`, `issue.assigned`, `issue.closed`, `issue.reopened`, `pull_request.merged`, `pull_request.reviewed`, `pull_request.review_commented`), the repository, the actor and the ids involved. Pull requests share the `issue.*` events, since a pull request is an issue.

`OutboxService` polls for unprocessed rows every two seconds, claims a batch with `FOR UPDATE SKIP LOCKED` so several API instances can share the work, and hands each event to its consumers. A failing event is retried on the next poll and set aside with its last error after five attempts.

The only consumer today is `NotifierService`. For each event it works out who to tell and why:

- assigned: the person assigned;
- mentioned: `@user` in the text the event carries;
- team_mentioned: `@org/team` for the repository's own organization, written by one of its members;
- author and subscribed: everyone subscribed to the thread;
- watching: everyone watching the repository at `all`.

Nobody hears about their own activity, about a repository they ignore, or about one they cannot read. Opening, commenting, reviewing, being mentioned and being assigned subscribe the person to the thread; an explicit unsubscribe outlasts that, though a mention or an assignment still notifies. Each person has one `notification` row per thread, bumped back to unread by later activity, and an email rendered from one of the `thread-*` templates. The emails share a `References` header per thread, so mail clients group them, and go only to verified addresses. An event reads at most 50 mentions.

## Why

Writing the event in the change's transaction means an event exists exactly when its change does: no notification for a comment that rolled back, and none lost to a crash between the commit and the send. Consumers read the rows when they run, not a snapshot, so the payload stays small and an event whose comment was deleted in the meantime is skipped.

Webhooks need the same events with the same guarantees. They become a second call in `OutboxService.dispatch` that writes one delivery row per subscribed hook, with its own retries and log; nothing that publishes events changes.

## Consequences

- Delivery is at least once. A consumer must tolerate running twice: notification rows are upserts, but an email can repeat if a batch fails after sending.
- A batch holds its row locks while consumers run, emails included.
- Editing an issue or comment to add a mention does not notify yet.
- There is no per-user email preference yet; unsubscribing from a thread or ignoring a repository is the control.
- Only verified addresses get email, so an instance with email verification off sends none; the inbox still fills.
- Processed events are kept; nothing prunes the table yet.
