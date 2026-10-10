"use client";

import { Plus, X } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  Field,
  FieldContent,
  FieldDescription,
  FieldError,
  FieldGroup,
  FieldLabel,
  FieldLegend,
  FieldSeparator,
  FieldSet,
} from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";

export const MAX_DESCRIPTION_LENGTH = 400;
export const MAX_CALLBACK_URLS = 10;

export type OauthAppValues = {
  name: string;
  description: string;
  homepageUrl: string;
  callbackUrls: string[];
  deviceFlowEnabled: boolean;
  expireUserTokens: boolean;
};

export const EMPTY_OAUTH_APP: OauthAppValues = {
  name: "",
  description: "",
  homepageUrl: "",
  callbackUrls: [""],
  deviceFlowEnabled: false,
  expireUserTokens: false,
};

const LOOPBACK = new Set(["localhost", "127.0.0.1", "[::1]"]);

/** What is wrong with a callback URL, in words, before the API refuses it; null when it is fine or still empty. */
export function callbackProblem(value: string) {
  if (!value.trim()) return null;
  let url: URL;
  try {
    url = new URL(value.trim());
  } catch {
    return "Enter the full URL, starting with https://";
  }
  const loopback = LOOPBACK.has(url.hostname);
  if (url.protocol === "http:" && !loopback)
    return "Use https. Plain http works only on localhost.";
  if (url.protocol === "https:" && loopback)
    return "Use http:// for localhost.";
  if (url.protocol !== "http:" && url.protocol !== "https:")
    return "Use an https:// URL.";
  if (url.hash) return "Leave out the #fragment.";
  return null;
}

/** Whether the form can be sent: every required field filled and every callback well-formed. */
export function oauthAppReady(values: OauthAppValues) {
  const callbacks = values.callbackUrls.filter((url) => url.trim());
  return (
    Boolean(values.name.trim() && values.homepageUrl.trim()) &&
    callbacks.length > 0 &&
    callbacks.every((url) => !callbackProblem(url))
  );
}

/** Every field an OAuth app is registered and edited with, grouped and explained so nobody has to know OAuth to fill it in. */
export function OauthAppFields({
  values,
  disabled,
  onChange,
}: {
  values: OauthAppValues;
  disabled: boolean;
  onChange: (values: OauthAppValues) => void;
}) {
  const set = (patch: Partial<OauthAppValues>) =>
    onChange({ ...values, ...patch });
  const setCallback = (index: number, url: string) =>
    set({
      callbackUrls: values.callbackUrls.map((each, at) =>
        at === index ? url : each,
      ),
    });

  return (
    <FieldGroup>
      <FieldSet>
        <FieldLegend>About the application</FieldLegend>
        <FieldDescription>
          People see this when your app asks to use their Ghost account.
        </FieldDescription>
        <FieldGroup>
          <Field>
            <FieldLabel htmlFor="oauth-app-name">Application name</FieldLabel>
            <Input
              id="oauth-app-name"
              placeholder="Release bot"
              maxLength={100}
              value={values.name}
              disabled={disabled}
              required
              onChange={(event) => set({ name: event.target.value })}
            />
          </Field>
          <Field>
            <FieldLabel htmlFor="oauth-app-description">
              Description{" "}
              <span className="font-normal text-muted-foreground">
                (optional)
              </span>
            </FieldLabel>
            <Textarea
              id="oauth-app-description"
              placeholder="Publishes a release whenever a version tag is pushed."
              maxLength={MAX_DESCRIPTION_LENGTH}
              value={values.description}
              disabled={disabled}
              onChange={(event) => set({ description: event.target.value })}
            />
            <FieldDescription className="text-right tabular-nums">
              {values.description.length}/{MAX_DESCRIPTION_LENGTH}
            </FieldDescription>
          </Field>
          <Field>
            <FieldLabel htmlFor="oauth-app-homepage">Homepage URL</FieldLabel>
            <Input
              id="oauth-app-homepage"
              type="url"
              inputMode="url"
              placeholder="https://bot.example"
              value={values.homepageUrl}
              disabled={disabled}
              required
              onChange={(event) => set({ homepageUrl: event.target.value })}
            />
            <FieldDescription>
              Your app&apos;s website. People can follow it before they decide.
            </FieldDescription>
          </Field>
        </FieldGroup>
      </FieldSet>

      <FieldSeparator />

      <FieldSet>
        <FieldLegend>Callback URLs</FieldLegend>
        <FieldDescription>
          After someone approves your app, Ghost sends them back to one of these
          addresses with a one-time code. Use https, or http://localhost while
          you develop. If your app does not say which one, Ghost uses the first.
        </FieldDescription>
        <FieldGroup className="gap-3">
          {values.callbackUrls.map((url, index) => {
            const problem = callbackProblem(url);
            return (
              <Field key={index} data-invalid={Boolean(problem)}>
                <div className="flex gap-2">
                  <Input
                    aria-label={`Callback URL ${index + 1}`}
                    type="url"
                    inputMode="url"
                    placeholder={
                      index === 0
                        ? "https://bot.example/oauth/callback"
                        : "http://localhost:3000/oauth/callback"
                    }
                    value={url}
                    disabled={disabled}
                    aria-invalid={Boolean(problem)}
                    onChange={(event) => setCallback(index, event.target.value)}
                  />
                  {values.callbackUrls.length > 1 && (
                    <Button
                      type="button"
                      size="icon"
                      variant="ghost"
                      aria-label={`Remove callback URL ${index + 1}`}
                      disabled={disabled}
                      onClick={() =>
                        set({
                          callbackUrls: values.callbackUrls.filter(
                            (_, at) => at !== index,
                          ),
                        })
                      }
                    >
                      <X />
                    </Button>
                  )}
                </div>
                {problem && <FieldError>{problem}</FieldError>}
              </Field>
            );
          })}
          {values.callbackUrls.length < MAX_CALLBACK_URLS && (
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="self-start"
              disabled={disabled}
              onClick={() =>
                set({ callbackUrls: [...values.callbackUrls, ""] })
              }
            >
              <Plus />
              Add another callback URL
            </Button>
          )}
        </FieldGroup>
      </FieldSet>

      <FieldSeparator />

      <FieldSet>
        <FieldLegend>Sign-in without a browser redirect</FieldLegend>
        <Field orientation="horizontal">
          <FieldContent>
            <FieldLabel htmlFor="oauth-app-device-flow">
              Enable device flow
            </FieldLabel>
            <FieldDescription>
              For command-line tools and devices that cannot open a callback,
              like gh. The app shows a short code, and people approve it on
              Ghost&apos;s device page. Leave it off for web apps.
            </FieldDescription>
          </FieldContent>
          <Switch
            id="oauth-app-device-flow"
            checked={values.deviceFlowEnabled}
            disabled={disabled}
            onCheckedChange={(checked) => set({ deviceFlowEnabled: checked })}
          />
        </Field>
      </FieldSet>

      <FieldSeparator />

      <FieldSet>
        <FieldLegend>Tokens</FieldLegend>
        <Field orientation="horizontal">
          <FieldContent>
            <FieldLabel htmlFor="oauth-app-expire-user-tokens">
              Expire user authorization tokens
            </FieldLabel>
            <FieldDescription>
              Access tokens stop working after 8 hours and come with a refresh
              token, valid for 6 months, that gets a new one. Turning it off
              changes only tokens issued afterwards.
            </FieldDescription>
          </FieldContent>
          <Switch
            id="oauth-app-expire-user-tokens"
            checked={values.expireUserTokens}
            disabled={disabled}
            onCheckedChange={(checked) => set({ expireUserTokens: checked })}
          />
        </Field>
      </FieldSet>
    </FieldGroup>
  );
}
