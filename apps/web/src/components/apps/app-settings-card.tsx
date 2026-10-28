"use client";

import { useRouter } from "next/navigation";
import { useAction } from "next-safe-action/hooks";
import { useState } from "react";
import { toast } from "sonner";

import { SettingCard } from "@/components/repositories/setting-card";
import type { components } from "@/lib/api/v1";

import { updateApp } from "./actions";
import { AppFields, type AppValues, appReady } from "./app-fields";

export function AppSettingsCard({
  app,
}: {
  app: components["schemas"]["AppDTO"];
}) {
  const router = useRouter();
  const saved: AppValues = {
    name: app.name,
    description: app.description ?? "",
    homepageUrl: app.homepageUrl,
    setupUrl: app.setupUrl ?? "",
    webhookUrl: app.webhookUrl ?? "",
    webhookSecret: "",
    permissions: app.permissions,
    events: app.events,
  };
  const [values, setValues] = useState(saved);
  const update = useAction(updateApp, {
    onSuccess: () => {
      toast.success("App saved");
      setValues((current) => ({ ...current, webhookSecret: "" }));
      router.refresh();
    },
    onError: ({ error }) =>
      toast.error(error.serverError ?? "Could not save this app."),
  });

  return (
    <SettingCard
      title="Settings"
      hint="Its bot keeps its name when you rename the app."
      onSubmit={() => update.execute({ slug: app.slug, ...values })}
      pending={update.isExecuting}
      canSave={
        JSON.stringify(values) !== JSON.stringify(saved) && appReady(values)
      }
    >
      <AppFields
        values={values}
        disabled={update.isExecuting}
        slug={app.slug}
        webhookSecretSet={app.webhookSecretSet}
        onChange={setValues}
      />
    </SettingCard>
  );
}
