"use client";

import { useRouter } from "next/navigation";
import { useAction } from "next-safe-action/hooks";
import { useState } from "react";
import { toast } from "sonner";

import { updateOauthApp } from "@/components/oauth-apps/actions";
import {
  OauthAppFields,
  type OauthAppValues,
  oauthAppReady,
} from "@/components/oauth-apps/oauth-app-fields";
import { SettingCard } from "@/components/repositories/setting-card";
import type { components } from "@/lib/api/v1";

export function OauthAppSettingsCard({
  app,
}: {
  app: components["schemas"]["OauthAppDTO"];
}) {
  const router = useRouter();
  const saved: OauthAppValues = {
    name: app.name,
    description: app.description ?? "",
    homepageUrl: app.homepageUrl,
    callbackUrls: app.callbackUrls,
    deviceFlowEnabled: app.deviceFlowEnabled,
  };
  const [values, setValues] = useState(saved);
  const update = useAction(updateOauthApp, {
    onSuccess: () => {
      toast.success("OAuth app saved");
      router.refresh();
    },
    onError: ({ error }) =>
      toast.error(error.serverError ?? "Could not save this app."),
  });
  const changed = JSON.stringify(values) !== JSON.stringify(saved);

  return (
    <SettingCard
      title="Settings"
      hint="Changes apply to the next person who signs in."
      onSubmit={() =>
        update.execute({
          clientId: app.clientId,
          ...values,
          callbackUrls: values.callbackUrls.filter((url) => url.trim()),
        })
      }
      pending={update.isExecuting}
      canSave={changed && oauthAppReady(values)}
    >
      <OauthAppFields
        values={values}
        disabled={update.isExecuting}
        onChange={setValues}
      />
    </SettingCard>
  );
}
