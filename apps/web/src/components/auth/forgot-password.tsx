"use client";

import { getViewURL, validateEmailAddress } from "@better-auth-ui/core";
import {
  useAuth,
  useFetchOptions,
  useRequestPasswordReset,
} from "@better-auth-ui/react";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { FieldDescription, FieldGroup } from "@/components/ui/field";
import { Spinner } from "@/components/ui/spinner";
import { useAuthForm } from "./auth-form";
import { RESET_LINK_SENT_STORAGE_KEY } from "./reset-link-sent";

/** Render a card-based "Forgot Password" form that sends a password-reset email. */
export function ForgotPassword() {
  const {
    authClient,
    baseURL,
    basePaths,
    localization,
    navigate,
    viewPaths,
    Link,
  } = useAuth();

  const { fetchOptions, resetFetchOptions } = useFetchOptions();

  const { mutate: requestPasswordReset, isPending } = useRequestPasswordReset(
    authClient,
    {
      onError: () => {
        resetFetchOptions();
      },
      onSuccess: (_data, { email }) => {
        sessionStorage.setItem(RESET_LINK_SENT_STORAGE_KEY, email);
        navigate({ to: `${basePaths.auth}/${viewPaths.auth.resetLinkSent}` });
      },
    },
  );

  const form = useAuthForm({
    defaultValues: { email: "" },
    onSubmit: ({ value }) =>
      requestPasswordReset({
        email: value.email,
        redirectTo: getViewURL(
          baseURL,
          basePaths.auth,
          viewPaths.auth.resetPassword,
        ),
        fetchOptions,
      }),
  });

  return (
    <Card className="w-full max-w-sm">
      <CardHeader>
        <CardTitle className="text-xl font-semibold">
          {localization.auth.forgotPassword}
        </CardTitle>
      </CardHeader>

      <CardContent>
        <form.AppForm>
          <form.AuthFormRoot>
            <FieldGroup>
              <form.AppField
                name="email"
                validators={{
                  onChange: ({ value }) =>
                    validateEmailAddress(value, {
                      invalidMessage: localization.auth.invalidEmail,
                      requiredMessage: localization.auth.fieldRequired,
                    }),
                }}
              >
                {(field) => (
                  <field.AuthFormTextField
                    label={localization.auth.email}
                    type="email"
                    autoComplete="email"
                    placeholder={localization.auth.emailPlaceholder}
                    required
                    disabled={isPending}
                  />
                )}
              </form.AppField>

              <div className="flex flex-col gap-3">
                <form.AuthFormSubmitButton disabled={isPending}>
                  {isPending && <Spinner />}
                  {localization.auth.sendResetLink}
                </form.AuthFormSubmitButton>
              </div>
            </FieldGroup>
          </form.AuthFormRoot>
        </form.AppForm>

        <div className="flex flex-col gap-3 items-center w-full mt-4">
          <FieldDescription className="text-center">
            {localization.auth.rememberYourPassword}{" "}
            <Link
              href={`${basePaths.auth}/${viewPaths.auth.signIn}`}
              className="underline underline-offset-4"
            >
              {localization.auth.signIn}
            </Link>
          </FieldDescription>
        </div>
      </CardContent>
    </Card>
  );
}
