"use client";

import {
  getViewURL,
  isPasswordCompromisedError,
  validateStringLength,
} from "@better-auth-ui/core";
import {
  useAuth,
  useChangePassword,
  useFetchOptions,
  useListAccounts,
  useRequestPasswordReset,
  useSession,
} from "@better-auth-ui/react";
import { useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardFooter } from "@/components/ui/card";
import { Spinner } from "@/components/ui/spinner";
import { useAuthForm, usePasswordValidator } from "../../auth-form";
import { OpenEmailButton } from "../../open-email-button";
import { PasswordStrengthMeter } from "../../password-strength-meter";

export function ChangePassword() {
  const { authClient } = useAuth();
  const { data: session } = useSession(authClient);
  const { data: accounts, isPending: isAccountsPending } =
    useListAccounts(authClient);

  const hasCredentialAccount = accounts?.some(
    (account) => account.providerId === "credential",
  );

  if (!isAccountsPending && !hasCredentialAccount) {
    return <SetPassword />;
  }

  return (
    <ChangePasswordForm session={isAccountsPending ? undefined : session} />
  );
}

function SetPassword() {
  const { authClient, basePaths, baseURL, localization, viewPaths } = useAuth();
  const { data: session } = useSession(authClient);
  const { fetchOptions, resetFetchOptions } = useFetchOptions();
  const [sentEmail, setSentEmail] = useState("");

  const { mutate: requestPasswordReset, isPending } = useRequestPasswordReset(
    authClient,
    {
      onError: () => {
        resetFetchOptions();
      },
      onSuccess: (_data, { email }) => {
        setSentEmail(email);
      },
    },
  );

  const handleSetPassword = () => {
    if (!session) return;

    requestPasswordReset({
      email: session.user.email,
      redirectTo: getViewURL(
        baseURL,
        basePaths.auth,
        viewPaths.auth.resetPassword,
      ),
      fetchOptions,
    });
  };

  return (
    <div>
      <h2 className="text-sm font-semibold mb-3">
        {localization.settings.changePassword}
      </h2>

      <Card>
        <CardContent className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <p className="text-sm font-medium leading-tight">
              {localization.settings.setPassword}
            </p>

            <p className="text-muted-foreground text-xs mt-0.5">
              {localization.settings.setPasswordDescription}
            </p>
          </div>

          {sentEmail ? (
            <div className="flex flex-col gap-3 items-start sm:items-end">
              <p className="text-sm" role="status">
                {localization.auth.resetLinkSentTo.replace(
                  "{{email}}",
                  sentEmail,
                )}
              </p>

              <OpenEmailButton email={sentEmail} className="w-auto" />
            </div>
          ) : (
            <div className="flex flex-col gap-3 items-start sm:items-end">
              <Button
                size="sm"
                disabled={isPending || !session?.user.email}
                onClick={handleSetPassword}
              >
                {isPending && <Spinner />}

                {localization.auth.sendResetLink}
              </Button>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function ChangePasswordForm({
  session,
}: {
  session: ReturnType<typeof useSession>["data"];
}) {
  const { authClient, localization } = useAuth();
  const passwordValidator = usePasswordValidator();
  const { mutateAsync: changePassword, isPending } = useChangePassword(
    authClient,
    {
      onError: (error) => {
        // The haveIBeenPwned plugin rejects on the password itself, so it belongs against the field rather than in a toast.
        setIsCompromised(isPasswordCompromisedError(error));
      },
      onSuccess: () => {
        form.reset();
        toast.success(localization.settings.changePasswordSuccess);
      },
    },
  );

  const [isCompromised, setIsCompromised] = useState(false);

  const form = useAuthForm({
    defaultValues: {
      currentPassword: "",
      newPassword: "",
    },
    onSubmit: async ({ value }) => {
      try {
        await changePassword({
          currentPassword: value.currentPassword,
          newPassword: value.newPassword,
          revokeOtherSessions: true,
        });
      } catch {
        // The mutation reports the error through its configured handler.
      }
    },
  });

  return (
    <div>
      <h2 className="text-sm font-semibold mb-3">
        {localization.settings.changePassword}
      </h2>

      <form.AppForm>
        <form.AuthFormRoot>
          <Card>
            <CardContent className="flex flex-col gap-6">
              <form.AppField
                name="currentPassword"
                validators={{
                  onChange: ({ value }) =>
                    validateStringLength(value, {
                      requiredMessage: localization.auth.fieldRequired,
                    }),
                }}
              >
                {(field) => (
                  <field.AuthFormPasswordField
                    label={localization.settings.currentPassword}
                    autoComplete="current-password"
                    placeholder={
                      localization.settings.currentPasswordPlaceholder
                    }
                    disabled={isPending}
                    isLoading={!session}
                  />
                )}
              </form.AppField>

              <form.AppField
                name="newPassword"
                validators={{ onChange: passwordValidator }}
              >
                {(field) => (
                  <field.AuthFormPasswordField
                    label={localization.auth.newPassword}
                    autoComplete="new-password"
                    placeholder={localization.auth.newPasswordPlaceholder}
                    disabled={isPending}
                    isLoading={!session}
                    isCompromised={isCompromised}
                    onValueChange={() => setIsCompromised(false)}
                  >
                    <PasswordStrengthMeter password={field.state.value} />
                  </field.AuthFormPasswordField>
                )}
              </form.AppField>
            </CardContent>

            <CardFooter>
              <form.AuthFormSubmitButton
                disabled={isPending || !session}
                size="sm"
              >
                {localization.settings.updatePassword}
              </form.AuthFormSubmitButton>
            </CardFooter>
          </Card>
        </form.AuthFormRoot>
      </form.AppForm>
    </div>
  );
}
