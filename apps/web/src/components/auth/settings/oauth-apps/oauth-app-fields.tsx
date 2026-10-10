"use client";

import {
  Field,
  FieldContent,
  FieldDescription,
  FieldGroup,
  FieldLabel,
} from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";

export type OauthAppValues = {
  name: string;
  homepageUrl: string;
  callbackUrl: string;
  deviceFlowEnabled: boolean;
};

/** The fields an OAuth app is registered and edited with. */
export function OauthAppFields({
  idPrefix,
  values,
  disabled,
  onChange,
}: {
  idPrefix: string;
  values: OauthAppValues;
  disabled: boolean;
  onChange: (values: OauthAppValues) => void;
}) {
  return (
    <FieldGroup>
      <Field>
        <FieldLabel htmlFor={`${idPrefix}-name`}>Application name</FieldLabel>
        <Input
          id={`${idPrefix}-name`}
          value={values.name}
          disabled={disabled}
          required
          onChange={(event) =>
            onChange({ ...values, name: event.target.value })
          }
        />
      </Field>
      <Field>
        <FieldLabel htmlFor={`${idPrefix}-homepage`}>Homepage URL</FieldLabel>
        <Input
          id={`${idPrefix}-homepage`}
          type="url"
          placeholder="https://bot.example"
          value={values.homepageUrl}
          disabled={disabled}
          required
          onChange={(event) =>
            onChange({ ...values, homepageUrl: event.target.value })
          }
        />
      </Field>
      <Field>
        <FieldLabel htmlFor={`${idPrefix}-callback`}>
          Authorization callback URL
        </FieldLabel>
        <Input
          id={`${idPrefix}-callback`}
          type="url"
          placeholder="https://bot.example/oauth/callback"
          value={values.callbackUrl}
          disabled={disabled}
          required
          onChange={(event) =>
            onChange({ ...values, callbackUrl: event.target.value })
          }
        />
        <FieldDescription>
          https, or http on localhost. A redirect_uri may point here or to a
          path under it.
        </FieldDescription>
      </Field>
      <Field orientation="horizontal">
        <FieldContent>
          <FieldLabel htmlFor={`${idPrefix}-device-flow`}>
            Enable device flow
          </FieldLabel>
          <FieldDescription>
            Lets a CLI sign users in with a code, as gh does.
          </FieldDescription>
        </FieldContent>
        <Switch
          id={`${idPrefix}-device-flow`}
          checked={values.deviceFlowEnabled}
          disabled={disabled}
          onCheckedChange={(checked) =>
            onChange({ ...values, deviceFlowEnabled: checked })
          }
        />
      </Field>
    </FieldGroup>
  );
}
