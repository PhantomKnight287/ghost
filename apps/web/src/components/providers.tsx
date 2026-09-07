"use client";

import { QueryClientProvider } from "@tanstack/react-query";
import { ThemeProvider } from "next-themes";
import Link from "next/link";
import { useRouter } from "next/navigation";
import type { ReactNode } from "react";

import { AuthProvider } from "@/components/auth/auth-provider";
import { authClient } from "@/lib/auth-client";
import { usernamePlugin } from "@/lib/auth/username-plugin";
import { apiKeyPlugin } from "@/lib/auth/api-key-plugin";

import { getQueryClient } from "@/lib/query-client";

export function Providers({ children }: { children: ReactNode }) {
  const router = useRouter();
  const queryClient = getQueryClient();

  return (
    <ThemeProvider
      attribute="class"
      defaultTheme="system"
      enableSystem
      disableTransitionOnChange
    >
      <QueryClientProvider client={queryClient}>
        <AuthProvider
          authClient={authClient}
          redirectTo="/dashboard"
          plugins={[usernamePlugin(), apiKeyPlugin()]}
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
