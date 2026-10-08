"use client";

import { useAuth } from "@better-auth-ui/react";
import { ActiveSessions } from "./active-sessions";
import { ChangePassword } from "./change-password";
import { GpgKeys } from "./gpg-keys";
import { LinkedAccounts } from "./linked-accounts";
import { SshKeys } from "./ssh-keys";

export function SecuritySettings() {
  const { plugins, socialProviders } = useAuth();

  return (
    <div className="flex w-full flex-col gap-4 md:gap-6">
      <ChangePassword />
      {!!socialProviders?.length && <LinkedAccounts />}
      <SshKeys />
      <GpgKeys />
      <ActiveSessions />
      {plugins.flatMap(
        (plugin) =>
          plugin.securityCards?.map((Card, index) => (
            <Card key={`${plugin.id}-${index.toString()}`} />
          )) ?? [],
      )}
    </div>
  );
}
