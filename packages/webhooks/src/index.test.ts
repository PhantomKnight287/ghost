import { describe, expect, test } from "bun:test";
import { APP_PERMISSIONS } from "@ghost/permissions";

import { INSTALLATION_EVENTS, WEBHOOK_EVENTS, webhookEvents } from "./index";

describe("WEBHOOK_EVENTS", () => {
  test("every event has a label and a permission from APP_PERMISSIONS", () => {
    for (const [event, { label, permission }] of Object.entries(
      WEBHOOK_EVENTS,
    )) {
      expect(label.length, event).toBeGreaterThan(0);
      expect(Object.hasOwn(APP_PERMISSIONS, permission), event).toBe(true);
    }
  });

  test("has the pull request lifecycle events with pull_requests", () => {
    for (const event of [
      "pull_request.opened",
      "pull_request.edited",
      "pull_request.closed",
      "pull_request.reopened",
    ] as const)
      expect(WEBHOOK_EVENTS[event].permission).toBe("pull_requests");
  });

  test("no installation event is subscribable", () => {
    const subscribable: readonly string[] = webhookEvents;
    for (const event of INSTALLATION_EVENTS)
      expect(subscribable).not.toContain(event);
  });

  test("webhookEvents follows the table's order", () => {
    expect([...webhookEvents]).toEqual(
      Object.keys(WEBHOOK_EVENTS) as (typeof webhookEvents)[number][],
    );
    expect(webhookEvents[0]).toBe("push");
  });
});
