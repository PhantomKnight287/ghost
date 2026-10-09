"use client";

import { QueryClientProvider } from "@tanstack/react-query";
import { ThemeProvider } from "next-themes";
import Link from "next/link";
import { useRouter } from "next/navigation";
import type { ReactNode } from "react";

import { AuthProvider } from "@/components/auth/auth-provider";
import { ThemeEffects } from "@/components/theme-effects";
import { authClient } from "@/lib/auth-client";
import { avatar } from "@/lib/auth/avatar";
import { GITHUB_SIGN_IN, SITE_URL } from "@/lib/env";
import { usernamePlugin } from "@/lib/auth/username-plugin";
import { organizationPlugin } from "@/lib/auth/organization-plugin";
import { organizationRoleLabels } from "@/lib/organization-role";
import { apiKeyPlugin } from "@/lib/auth/api-key-plugin";

import { getQueryClient } from "@/lib/query-client";
import { APP_THEME_IDS } from "@/lib/themes";
import { deviceAuthorizationPlugin } from "@/lib/auth/device-authorization-plugin";

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
            deviceAuthorizationPlugin()
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
