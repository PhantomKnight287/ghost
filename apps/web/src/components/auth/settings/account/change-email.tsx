"use client";

import { getViewURL, validateEmailAddress } from "@better-auth-ui/core";
import { useAuth, useChangeEmail, useSession } from "@better-auth-ui/react";
import { useEffect } from "react";
import { toast } from "sonner";

import { Card, CardContent, CardFooter } from "@/components/ui/card";
import { useAuthForm } from "../../auth-form";

export function ChangeEmail() {
  const { authClient, basePaths, baseURL, localization, viewPaths } = useAuth();
  const { data: session } = useSession(authClient);

  const { mutateAsync: changeEmail, isPending } = useChangeEmail(authClient, {
    onSuccess: () => toast.success(localization.settings.changeEmailSuccess),
  });

  const form = useAuthForm({
    defaultValues: { email: "" },
    onSubmit: async ({ value }) =>
      await changeEmail({
        callbackURL: getViewURL(
          baseURL,
          basePaths.settings,
          viewPaths.settings.account,
        ),
        newEmail: value.email,
      }),
  });

  useEffect(() => {
    if (session) form.reset({ email: session.user.email });
  }, [form, session]);

  return (
    <div>
      <h2 className="text-sm font-semibold mb-3">
        {localization.settings.changeEmail}
      </h2>

      <form.AppForm>
        <form.AuthFormRoot>
          <Card>
            <CardContent className="flex flex-col gap-6">
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
                    isLoading={!session}
                  />
                )}
              </form.AppField>
            </CardContent>

            <CardFooter>
              <form.AuthFormSubmitButton
                isPending={isPending}
                size="sm"
                disabled={isPending || !session}
              >
                {localization.settings.updateEmail}
              </form.AuthFormSubmitButton>
            </CardFooter>
          </Card>
        </form.AuthFormRoot>
      </form.AppForm>
    </div>
  );
}
