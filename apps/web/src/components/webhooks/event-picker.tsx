"use client";

import { Checkbox } from "@/components/ui/checkbox";
import {
  type WebhookEvent,
  webhookEventLabels,
  webhookEvents,
} from "@/lib/webhooks";

export function EventPicker({
  value,
  onChange,
}: {
  value: WebhookEvent[];
  onChange: (events: WebhookEvent[]) => void;
}) {
  const toggle = (event: WebhookEvent, checked: boolean) =>
    onChange(
      checked
        ? webhookEvents.filter((e) => e === event || value.includes(e))
        : value.filter((e) => e !== event),
    );

  return (
    <fieldset className="flex flex-col gap-3">
      <legend className="mb-3 text-sm font-medium">Events</legend>
      {webhookEvents.map((event) => (
        <label
          key={event}
          htmlFor={`event-${event}`}
          className="flex items-start gap-3 text-sm"
        >
          <Checkbox
            id={`event-${event}`}
            className="mt-0.5"
            checked={value.includes(event)}
            onCheckedChange={(checked) => toggle(event, checked === true)}
          />
          <span className="flex flex-col gap-0.5">
            <span className="font-mono text-xs">{event}</span>
            <span className="text-muted-foreground">
              {webhookEventLabels[event]}
            </span>
          </span>
        </label>
      ))}
    </fieldset>
  );
}
