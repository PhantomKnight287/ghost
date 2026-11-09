import { describe, expect, test } from "bun:test";
import { APP_PERMISSIONS } from "@ghost/permissions";

import {
  INSTALLATION_EVENTS,
  OWNING_APP_EVENTS,
  WEBHOOK_EVENTS,
  webhookEvents,
} from "./index";

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

  test("issue.deleted is subscribable and needs issues", () => {
    expect(WEBHOOK_EVENTS["issue.deleted"]).toEqual({
      label: "An issue is deleted",
      permission: "issues",
    });
    expect(webhookEvents as readonly string[]).toContain("issue.deleted");
  });

  test("check events need checks", () => {
    for (const event of [
      "check_run.created",
      "check_run.completed",
      "check_suite.completed",
    ] as const)
      expect(WEBHOOK_EVENTS[event].permission).toBe("checks");
  });

  test("no owning-app event is subscribable, and each needs checks", () => {
    const subscribable: readonly string[] = webhookEvents;
    for (const [event, { permission }] of Object.entries(OWNING_APP_EVENTS)) {
      expect(subscribable).not.toContain(event);
      expect(permission).toBe("checks");
    }
    expect(Object.keys(OWNING_APP_EVENTS)).toEqual([
      "check_run.rerequested",
      "check_run.requested_action",
      "check_suite.requested",
      "check_suite.rerequested",
    ]);
  });

  test("webhookEvents follows the table's order", () => {
    expect([...webhookEvents]).toEqual(
      Object.keys(WEBHOOK_EVENTS) as (typeof webhookEvents)[number][],
    );
    expect(webhookEvents[0]).toBe("push");
  });
});
