"use client";

import { type AppPermissions, appSlug } from "@ghost/permissions";
import {
  WEBHOOK_EVENTS,
  type WebhookEvent,
  webhookEvents,
} from "@ghost/webhooks";

import { Checkbox } from "@/components/ui/checkbox";
import {
  Field,
  FieldDescription,
  FieldGroup,
  FieldLabel,
  FieldLegend,
  FieldSeparator,
  FieldSet,
} from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";

import { PERMISSIONS } from "./permissions";

export const MAX_APP_NAME_LENGTH = 34;
export const MAX_APP_DESCRIPTION_LENGTH = 400;

export type AppValues = {
  name: string;
  description: string;
  homepageUrl: string;
  setupUrl: string;
  webhookUrl: string;
  webhookSecret: string;
  permissions: AppPermissions;
  events: string[];
};

export const EMPTY_APP: AppValues = {
  name: "",
  description: "",
  homepageUrl: "",
  setupUrl: "",
  webhookUrl: "",
  webhookSecret: "",
  permissions: {},
  events: [],
};

const NO_ACCESS = "none";

/** Whether the app may receive `event` with these permissions: metadata events always, the rest with read on their permission. */
function covers(permissions: AppPermissions, event: string) {
  const needed = WEBHOOK_EVENTS[event as WebhookEvent]?.permission;
  return needed === "metadata" || Boolean(needed && permissions[needed]);
}

/** Whether the form can be sent: a name that makes a slug, and a homepage. */
export function appReady(values: AppValues) {
  return Boolean(appSlug(values.name) && values.homepageUrl.trim());
}

/** Every field a Ghost App is registered and edited with. Lowering a permission unticks the events it no longer covers. */
export function AppFields({
  values,
  disabled,
  slug,
  webhookSecretSet,
  onChange,
}: {
  values: AppValues;
  disabled: boolean;
  /** Set once the app exists: the slug never changes after registration. */
  slug?: string;
  webhookSecretSet?: boolean;
  onChange: (values: AppValues) => void;
}) {
  const set = (patch: Partial<AppValues>) => onChange({ ...values, ...patch });
  const botLogin = `${slug ?? (appSlug(values.name) || "your-app")}[bot]`;

  return (
    <FieldGroup>
      <FieldSet>
        <FieldLegend>About the app</FieldLegend>
        <FieldDescription>
          Anyone with its link sees this on the app&apos;s public page.
        </FieldDescription>
        <FieldGroup>
          <Field>
            <FieldLabel htmlFor="app-name">App name</FieldLabel>
            <Input
              id="app-name"
              placeholder="CI Bot"
              maxLength={MAX_APP_NAME_LENGTH}
              value={values.name}
              disabled={disabled}
              required
              onChange={(event) => set({ name: event.target.value })}
            />
            <FieldDescription>
              It acts as <code className="font-mono">{botLogin}</code>
              {slug
                ? ". Renaming keeps that name."
                : ", made from the name now and never changed afterwards."}
            </FieldDescription>
          </Field>
          <Field>
            <FieldLabel htmlFor="app-description">
              Description{" "}
              <span className="font-normal text-muted-foreground">
                (optional)
              </span>
            </FieldLabel>
            <Textarea
              id="app-description"
              placeholder="Posts a status on every commit it builds."
              maxLength={MAX_APP_DESCRIPTION_LENGTH}
              value={values.description}
              disabled={disabled}
              onChange={(event) => set({ description: event.target.value })}
            />
            <FieldDescription className="text-right tabular-nums">
              {values.description.length}/{MAX_APP_DESCRIPTION_LENGTH}
            </FieldDescription>
          </Field>
          <Field>
            <FieldLabel htmlFor="app-homepage">Homepage URL</FieldLabel>
            <Input
              id="app-homepage"
              type="url"
              inputMode="url"
              placeholder="https://ci.example"
              value={values.homepageUrl}
              disabled={disabled}
              required
              onChange={(event) => set({ homepageUrl: event.target.value })}
            />
          </Field>
          <Field>
            <FieldLabel htmlFor="app-setup">
              Setup URL{" "}
              <span className="font-normal text-muted-foreground">
                (optional)
              </span>
            </FieldLabel>
            <Input
              id="app-setup"
              type="url"
              inputMode="url"
              placeholder="https://ci.example/setup"
              value={values.setupUrl}
              disabled={disabled}
              onChange={(event) => set({ setupUrl: event.target.value })}
            />
            <FieldDescription>
              Where Ghost sends someone right after they install the app.
            </FieldDescription>
          </Field>
        </FieldGroup>
      </FieldSet>

      <FieldSeparator />

      <FieldSet>
        <FieldLegend>Webhook</FieldLegend>
        <FieldDescription>
          Where Ghost delivers the events below, in Ghost&apos;s webhook format,
          signed with the secret.
        </FieldDescription>
        <FieldGroup>
          <Field>
            <FieldLabel htmlFor="app-webhook-url">
              Webhook URL{" "}
              <span className="font-normal text-muted-foreground">
                (optional)
              </span>
            </FieldLabel>
            <Input
              id="app-webhook-url"
              type="url"
              inputMode="url"
              placeholder="https://ci.example/ghost/webhook"
              value={values.webhookUrl}
              disabled={disabled}
              onChange={(event) => set({ webhookUrl: event.target.value })}
            />
          </Field>
          <Field>
            <FieldLabel htmlFor="app-webhook-secret">Webhook secret</FieldLabel>
            <Input
              id="app-webhook-secret"
              type="password"
              autoComplete="off"
              placeholder={
                webhookSecretSet
                  ? "Set. Type a new one to replace it."
                  : "Required with a URL"
              }
              value={values.webhookSecret}
              disabled={disabled}
              onChange={(event) => set({ webhookSecret: event.target.value })}
            />
            <FieldDescription>
              Ghost never shows it again once saved.
            </FieldDescription>
          </Field>
        </FieldGroup>
      </FieldSet>

      <FieldSeparator />

      <FieldSet>
        <FieldLegend>Permissions</FieldLegend>
        <FieldDescription>
          What the app may do on the repositories it is installed on. It can
          always read their metadata: the repository, its branches and
          collaborators.
        </FieldDescription>
        <FieldGroup className="gap-4">
          {PERMISSIONS.map(({ name, label, detail, levels }) => (
            <Field
              key={name}
              orientation="horizontal"
              className="items-start justify-between"
            >
              <div className="flex flex-col gap-1">
                <FieldLabel htmlFor={`app-permission-${name}`}>
                  {label}
                </FieldLabel>
                <FieldDescription>{detail}</FieldDescription>
              </div>
              <Select
                value={values.permissions[name] ?? NO_ACCESS}
                disabled={disabled}
                onValueChange={(level) => {
                  const permissions: AppPermissions = { ...values.permissions };
                  if (level === NO_ACCESS) delete permissions[name];
                  else permissions[name] = level as "read" | "write";
                  set({
                    permissions,
                    events: values.events.filter((event) =>
                      covers(permissions, event),
                    ),
                  });
                }}
              >
                <SelectTrigger
                  id={`app-permission-${name}`}
                  className="w-full shrink-0 sm:w-40"
                >
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={NO_ACCESS}>No access</SelectItem>
                  <SelectItem value="read">Read</SelectItem>
                  {levels.includes("write") && (
                    <SelectItem value="write">Read and write</SelectItem>
                  )}
                </SelectContent>
              </Select>
            </Field>
          ))}
        </FieldGroup>
      </FieldSet>

      <FieldSeparator />

      <FieldSet>
        <FieldLegend>Events</FieldLegend>
        <FieldDescription>
          What Ghost tells the app about. Only events its permissions can read
          are offered.
        </FieldDescription>
        <div className="grid gap-2 sm:grid-cols-2">
          {webhookEvents
            .filter((event) => covers(values.permissions, event))
            .map((event) => (
              <Field key={event} orientation="horizontal">
                <Checkbox
                  id={`app-event-${event}`}
                  checked={values.events.includes(event)}
                  disabled={disabled}
                  onCheckedChange={(checked) =>
                    set({
                      events: checked
                        ? [...values.events, event]
                        : values.events.filter((each) => each !== event),
                    })
                  }
                />
                <FieldLabel
                  htmlFor={`app-event-${event}`}
                  className="font-mono text-xs font-normal"
                >
                  {event}
                </FieldLabel>
              </Field>
            ))}
        </div>
      </FieldSet>
    </FieldGroup>
  );
}
