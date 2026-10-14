"use client";

import { useAuth } from "@better-auth-ui/react";
import { ActiveSessions } from "./active-sessions";
import { ChangePassword } from "./change-password";
import { LinkedAccounts } from "./linked-accounts";

export function SecuritySettings() {
  const { plugins, socialProviders } = useAuth();

  return (
    <div className="flex w-full flex-col gap-4 md:gap-6">
      <ChangePassword />
      {plugins.flatMap((plugin) =>
        (plugin.securityCards ?? []).map((SecurityCard, index) => (
          <SecurityCard key={`${plugin.id}-${index.toString()}`} />
        )),
      )}
      {!!socialProviders?.length && <LinkedAccounts />}
      <ActiveSessions />
    </div>
  );
}
