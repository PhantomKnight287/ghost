"use client";

import { type AuthView, getProviderId } from "@better-auth-ui/core";
import { useAuth } from "@better-auth-ui/react";

import { ProviderButton } from "./provider-button";

/** Render sign-in buttons for configured social providers. Each button owns its own sign-in mutation and reads the shared sign-in pending state from React Query. */
export function ProviderButtons({ view }: { view: AuthView }) {
  const { socialProviders } = useAuth();

  return (
    <div className="flex flex-col gap-3">
      {socialProviders?.map((provider) => (
        <ProviderButton
          key={getProviderId(provider)}
          provider={provider}
          view={view}
        />
      ))}
    </div>
  );
}
