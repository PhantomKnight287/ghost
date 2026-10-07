"use client";

import {
  getAuthLinkURL,
  isPasswordCompromisedError,
} from "@better-auth-ui/core";
import { useAuth, useResetPassword } from "@better-auth-ui/react";
import { useEffect, useState } from "react";
import { toast } from "sonner";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { FieldDescription, FieldGroup } from "@/components/ui/field";
import { useAuthForm, usePasswordValidator } from "./auth-form";
import { PasswordStrengthMeter } from "./password-strength-meter";

/** Render a password reset form that validates the reset token from the URL, accepts a new password and submits it to the auth client. */
export function ResetPassword() {
  const {
    authClient,
    basePaths,
    localization,
    navigate,
    redirectTo,
    viewPaths,
    Link,
  } = useAuth();
  const signInURL = getAuthLinkURL(
    `${basePaths.auth}/${viewPaths.auth.signIn}`,
    redirectTo,
  );

  const passwordValidator = usePasswordValidator();

  const { mutateAsync: resetPassword, isPending } = useResetPassword(
    authClient,
    {
      onError: (error) => {
        // The haveIBeenPwned plugin rejects on the password itself, so it belongs against the field rather than in a toast.
        if (isPasswordCompromisedError(error)) {
          setIsCompromised(true);
        }
      },
      onSuccess: () => {
        toast.success(localization.auth.passwordResetSuccess);
        navigate({ to: signInURL });
      },
    },
  );

  const [isCompromised, setIsCompromised] = useState(false);

  useEffect(() => {
    const searchParams = new URLSearchParams(window.location.search);
    const token = searchParams.get("token") as string;

    if (!token) {
      toast.error(localization.auth.invalidResetPasswordToken);
      navigate({ to: signInURL });
    }
  }, [localization.auth.invalidResetPasswordToken, navigate, signInURL]);

  const form = useAuthForm({
    defaultValues: { password: "" },
    onSubmit: async ({ value }) => {
      const searchParams = new URLSearchParams(window.location.search);
      const token = searchParams.get("token") as string;

      if (!token) {
        toast.error(localization.auth.invalidResetPasswordToken);
        navigate({ to: signInURL });
        return;
      }

      try {
        await resetPassword({ token, newPassword: value.password });
      } catch {
        // The mutation reports the error through its configured handler.
      }
    },
  });

  return (
    <Card className="w-full max-w-sm">
      <CardHeader>
        <CardTitle className="text-xl font-semibold">
          {localization.auth.resetPassword}
        </CardTitle>
      </CardHeader>

      <CardContent>
        <form.AppForm>
          <form.AuthFormRoot>
            <FieldGroup>
              <form.AppField
                name="password"
                validators={{ onChange: passwordValidator }}
              >
                {(field) => (
                  <field.AuthFormPasswordField
                    label={localization.auth.password}
                    autoComplete="new-password"
                    placeholder={localization.auth.newPasswordPlaceholder}
                    disabled={isPending}
                    error={
                      isCompromised && localization.auth.passwordCompromised
                    }
                    onValueChange={() => setIsCompromised(false)}
                  >
                    <PasswordStrengthMeter password={field.state.value} />
                  </field.AuthFormPasswordField>
                )}
              </form.AppField>

              <form.AuthFormSubmitButton disabled={isPending}>
                {localization.auth.resetPassword}
              </form.AuthFormSubmitButton>
            </FieldGroup>
          </form.AuthFormRoot>
        </form.AppForm>

        <div className="flex flex-col gap-3 items-center w-full mt-4">
          <FieldDescription className="text-center">
            {localization.auth.rememberYourPassword}{" "}
            <Link
              href={getAuthLinkURL(
                `${basePaths.auth}/${viewPaths.auth.signIn}`,
                redirectTo,
              )}
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
