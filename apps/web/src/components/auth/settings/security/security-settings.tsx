"use client";

import { useAuth } from "@better-auth-ui/react";
import { ActiveSessions } from "./active-sessions";
import { ChangePassword } from "./change-password";
import { LinkedAccounts } from "./linked-accounts";

export function SecuritySettings() {
  const { socialProviders } = useAuth();

  return (
    <div className="flex w-full flex-col gap-4 md:gap-6">
      <ChangePassword />
      {!!socialProviders?.length && <LinkedAccounts />}
      <ActiveSessions />
    </div>
  );
}
