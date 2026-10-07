"use client";

import type { AuthView } from "@better-auth-ui/core";
import { useAuth } from "@better-auth-ui/react";
import type { ComponentType } from "react";

import { AuthRedirect } from "./auth-redirect";
import { AuthCallback, AuthError } from "./auth-result";
import { ForgotPassword } from "./forgot-password";
import { ResetLinkSent } from "./reset-link-sent";
import { ResetPassword } from "./reset-password";
import { SignOut } from "./sign-out";
import { SignUp } from "./sign-up";
import { VerifyEmail } from "./verify-email";

export type AuthProps = {
  className?: string;
};

// signIn has no entry: the username plugin always supplies it.
const AUTH_VIEWS: Partial<Record<AuthView, ComponentType<AuthProps>>> = {
  callback: AuthCallback,
  error: AuthError,
  redirect: AuthRedirect,
  signOut: SignOut,
  signUp: SignUp,
  forgotPassword: ForgotPassword,
  resetPassword: ResetPassword,
  resetLinkSent: ResetLinkSent,
  verifyEmail: VerifyEmail,
};

/** Renders the authentication view at `path`, preferring a plugin's view over the built-in one. */
export function Auth({ path }: { path: string }) {
  const { plugins, viewPaths } = useAuth();

  const authView = (Object.keys(viewPaths.auth) as AuthView[]).find(
    (key) => viewPaths.auth[key] === path,
  );

  for (const plugin of plugins) {
    const pluginAuthPaths = plugin.viewPaths?.auth;
    const pluginView =
      authView ??
      (pluginAuthPaths &&
        Object.keys(pluginAuthPaths).find(
          (key) => pluginAuthPaths[key] === path,
        ));
    const PluginView = pluginView && plugin.views?.auth?.[pluginView];
    if (PluginView) return <PluginView />;
  }

  const AuthView = authView && AUTH_VIEWS[authView];
  if (!AuthView) {
    throw new Error(
      `Unknown auth view "${authView ?? path}". Valid views are: ${Object.keys(AUTH_VIEWS).join(", ")}`,
    );
  }

  return <AuthView />;
}
