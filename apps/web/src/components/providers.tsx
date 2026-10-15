"use client";

import { Databuddy } from "@databuddy/sdk/react";
import { QueryClientProvider } from "@tanstack/react-query";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ThemeProvider } from "next-themes";
import type { ReactNode } from "react";

import { AuthProvider } from "@/components/auth/auth-provider";
import { ThemeEffects } from "@/components/theme-effects";
import { apiKeyPlugin } from "@/lib/auth/api-key-plugin";
import { avatar } from "@/lib/auth/avatar";
import { deviceAuthorizationPlugin } from "@/lib/auth/device-authorization-plugin";
import { organizationPlugin } from "@/lib/auth/organization-plugin";
import { passkeyPlugin } from "@/lib/auth/passkey-plugin";
import { twoFactorPlugin } from "@/lib/auth/two-factor-plugin";
import { usernamePlugin } from "@/lib/auth/username-plugin";
import { authClient } from "@/lib/auth-client";
import { DATABUDDY_CLIENT_ID, GITHUB_SIGN_IN, SITE_URL } from "@/lib/env";
import { organizationRoleLabels } from "@/lib/organization-role";
import { getQueryClient } from "@/lib/query-client";
import { APP_THEME_IDS } from "@/lib/themes";

export function Providers({ children }: { children: ReactNode }) {
  const router = useRouter();
  const queryClient = getQueryClient();

  return (
    <ThemeProvider
      attribute="class"
      defaultTheme="system"
      enableSystem
      disableTransitionOnChange
      themes={APP_THEME_IDS}
    >
      <ThemeEffects />
      {DATABUDDY_CLIENT_ID ? (
        <Databuddy
          clientId={DATABUDDY_CLIENT_ID}
          trackWebVitals={true}
          trackErrors
          trackInteractions
          trackOutgoingLinks
          trackHashChanges
          trackAttributes
        />
      ) : null}
      <QueryClientProvider client={queryClient}>
        <AuthProvider
          authClient={authClient}
          avatar={avatar}
          // Callback URLs go to the API, which resolves a relative one against its own origin.
          baseURL={SITE_URL}
          redirectTo="/dashboard"
          socialProviders={GITHUB_SIGN_IN ? ["github"] : undefined}
          plugins={[
            usernamePlugin(),
            apiKeyPlugin(),
            organizationPlugin({
              creatorRole: "owner",
              roles: organizationRoleLabels,
              teams: true,
            }),
            deviceAuthorizationPlugin(),
            passkeyPlugin(),
            twoFactorPlugin(),
          ]}
          navigate={({ to, replace }) =>
            replace ? router.replace(to) : router.push(to)
          }
          Link={Link}
        >
          {children}
        </AuthProvider>
      </QueryClientProvider>
    </ThemeProvider>
  );
}
