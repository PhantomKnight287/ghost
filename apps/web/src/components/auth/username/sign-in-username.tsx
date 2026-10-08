"use client";

import { authMutationKeys, validateStringLength } from "@better-auth-ui/core";
import type { UsernameAuthClient } from "@better-auth-ui/core/plugins/username";
import {
  AuthPrompts,
  useAuth,
  useAuthPlugin,
  useFetchOptions,
  useSignInEmail,
} from "@better-auth-ui/react";
import { useSignInUsername } from "@better-auth-ui/react/plugins/username";
import { useIsMutating } from "@tanstack/react-query";
import { ProviderButtons } from "@/components/auth/provider-buttons";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  FieldDescription,
  FieldGroup,
  FieldSeparator,
} from "@/components/ui/field";
import { Spinner } from "@/components/ui/spinner";
import { usernamePlugin } from "@/lib/auth/username-plugin";
import { useAuthForm, usePasswordValidator } from "../auth-form";
import { LastUsedBadge } from "../last-login-method/last-used-badge";

function isEmail(value: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
}

/** Render the username-based sign-in form, which routes non-email inputs through `signInUsername` instead of `signInEmail`. */
export function SignInUsername() {
  const {
    authClient,
    basePaths,
    localization,
    redirectTo,
    socialProviders,
    viewPaths,
    navigate,
    Link,
  } = useAuth<UsernameAuthClient>();

  const { fetchOptions, resetFetchOptions } = useFetchOptions();
  const passwordValidator = usePasswordValidator();
  const continueSignIn = () => navigate({ to: redirectTo });

  const { localization: usernameLocalization } = useAuthPlugin(usernamePlugin);

  // The verify-email page prefills the address it can know: an email sign-in has one, a username sign-in does not.
  const failed = (
    error: { error?: { code?: string } | null },
    email?: string,
  ) => {
    form.setFieldValue("password", "");
    if (error.error?.code === "EMAIL_NOT_VERIFIED") {
      if (email) sessionStorage.setItem("better-auth-ui.verify-email", email);
      else sessionStorage.removeItem("better-auth-ui.verify-email");
      navigate({ to: `${basePaths.auth}/${viewPaths.auth.verifyEmail}` });
    }
    resetFetchOptions();
  };
  const signedIn = () => {
    sessionStorage.removeItem("better-auth-ui.verify-email");
    continueSignIn();
  };

  const { mutate: signInEmail, isPending: isSignInEmailPending } =
    useSignInEmail(authClient, {
      onError: (error, { email }) => failed(error, email),
      onSuccess: signedIn,
    });

  const { mutate: signInUsername, isPending: isSignInUsernamePending } =
    useSignInUsername(authClient, {
      onError: (error) => failed(error),
      onSuccess: signedIn,
    });

  const signInMutating = useIsMutating({
    mutationKey: authMutationKeys.signIn.all,
  });
  const signUpMutating = useIsMutating({
    mutationKey: authMutationKeys.signUp.all,
  });
  const isPending = signInMutating + signUpMutating > 0;
  const isSignInPending = isSignInEmailPending || isSignInUsernamePending;

  const form = useAuthForm({
    defaultValues: { identifier: "", password: "" },
    onSubmit: ({ value }) => {
      if (isEmail(value.identifier)) {
        signInEmail({
          email: value.identifier,
          password: value.password,
          fetchOptions,
        });
      } else {
        signInUsername({
          username: value.identifier,
          password: value.password,
          fetchOptions,
        });
      }
    },
  });

  return (
    <Card className="w-full max-w-sm">
      <AuthPrompts view="signIn" />
      <CardHeader>
        <CardTitle className="text-xl font-semibold">
          {localization.auth.signIn}
        </CardTitle>
      </CardHeader>

      <CardContent>
        <div className="flex flex-col gap-6">
          <form.AppForm>
            <form.AuthFormRoot>
              <FieldGroup>
                <form.AppField
                  name="identifier"
                  validators={{
                    onChange: ({ value }) =>
                      validateStringLength(value, {
                        requiredMessage: localization.auth.fieldRequired,
                        trim: true,
                      }),
                  }}
                >
                  {(field) => (
                    <field.AuthFormTextField
                      id="email"
                      label={usernameLocalization.username}
                      type="text"
                      autoComplete="username"
                      placeholder={
                        usernameLocalization.usernameOrEmailPlaceholder
                      }
                      required
                      disabled={isPending}
                    />
                  )}
                </form.AppField>

                <form.AppField
                  name="password"
                  validators={{ onChange: passwordValidator }}
                >
                  {(field) => (
                    <field.AuthFormPasswordField
                      label={localization.auth.password}
                      autoComplete="current-password"
                      disabled={isPending}
                    />
                  )}
                </form.AppField>

                <form.AuthFormSubmitButton
                  className="relative overflow-visible"
                  disabled={isPending}
                >
                  {isSignInPending && <Spinner />}

                  {localization.auth.signIn}

                  <LastUsedBadge method={["email", "username"]} floating />
                </form.AuthFormSubmitButton>
              </FieldGroup>
            </form.AuthFormRoot>
          </form.AppForm>

          {socialProviders && socialProviders.length > 0 && (
            <>
              <FieldSeparator className="*:data-[slot=field-separator-content]:bg-card text-xs flex items-center">
                {localization.auth.or}
              </FieldSeparator>
              <ProviderButtons view="signIn" />
            </>
          )}
        </div>

        <div className="flex flex-col gap-3 items-center w-full mt-4">
          <Link
            href={`${basePaths.auth}/${viewPaths.auth.forgotPassword}`}
            className="self-center text-sm underline-offset-4 hover:underline"
          >
            {localization.auth.forgotPasswordLink}
          </Link>

          <FieldDescription className="text-center">
            {localization.auth.needToCreateAnAccount}{" "}
            <Link
              href={`${basePaths.auth}/${viewPaths.auth.signUp}`}
              className="underline underline-offset-4"
            >
              {localization.auth.signUp}
            </Link>
          </FieldDescription>
        </div>
      </CardContent>
    </Card>
  );
}
