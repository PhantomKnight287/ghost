"use client";

import {
  authMutationKeys,
  getAdditionalFieldDefaultValues,
  getAdditionalFieldSubmitValues,
  getAuthLinkURL,
  isPasswordCompromisedError,
  validateEmailAddress,
  validateStringLength,
} from "@better-auth-ui/core";
import {
  AuthPrompts,
  useAuth,
  useFetchOptions,
  useSignUpEmail,
} from "@better-auth-ui/react";
import { useIsMutating } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  FieldDescription,
  FieldGroup,
  FieldSeparator,
} from "@/components/ui/field";
import {
  getAuthAdditionalFieldValidators,
  useAuthForm,
  usePasswordValidator,
} from "./auth-form";
import { PasswordStrengthMeter } from "./password-strength-meter";
import { ProviderButtons } from "./provider-buttons";

/** Renders a sign-up form with name, email, and password fields, optional social provider buttons, and submission handling. */
export function SignUp() {
  const {
    additionalFields,
    authClient,
    basePaths,
    localization,
    redirectTo,
    socialProviders,
    viewPaths,
    navigate,
    Link,
  } = useAuth();

  const { fetchOptions, resetFetchOptions } = useFetchOptions();
  const passwordValidator = usePasswordValidator();

  const { mutateAsync: signUpEmail } = useSignUpEmail(authClient, {
    onError: (error) => {
      // The haveIBeenPwned plugin rejects on the password itself, so it belongs against the field rather than in a toast.
      if (isPasswordCompromisedError(error)) {
        setIsCompromised(true);
      }

      form.setFieldValue("password", "");
      resetFetchOptions();
    },
    onSuccess: () => navigate({ to: redirectTo }),
  });

  const signInMutating = useIsMutating({
    mutationKey: authMutationKeys.signIn.all,
  });
  const signUpMutating = useIsMutating({
    mutationKey: authMutationKeys.signUp.all,
  });
  const isPending = signInMutating + signUpMutating > 0;

  const [isCompromised, setIsCompromised] = useState(false);
  const signUpFields = useMemo(
    () => additionalFields?.filter((field) => field.signUp) ?? [],
    [additionalFields],
  );
  const form = useAuthForm({
    defaultValues: {
      additionalFields: getAdditionalFieldDefaultValues(signUpFields),
      email: "",
      name: "",
      password: "",
    },
    onSubmit: async ({ value }) => {
      try {
        await signUpEmail({
          name: value.name,
          email: value.email.trim(),
          password: value.password,
          ...getAdditionalFieldSubmitValues(
            signUpFields,
            value.additionalFields,
          ),
          fetchOptions,
        });
      } catch {
        // The mutation reports the error through its configured handler.
      }
    },
  });

  return (
    <Card className="w-full max-w-sm">
      <AuthPrompts view="signUp" />
      <CardHeader>
        <CardTitle className="text-xl font-semibold">
          {localization.auth.signUp}
        </CardTitle>
      </CardHeader>

      <CardContent>
        <div className="flex flex-col gap-6">
          <form.AppForm>
            <form.AuthFormRoot>
              <FieldGroup>
                <form.AppField
                  name="name"
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
                      label={localization.auth.name}
                      type="text"
                      autoComplete="name"
                      placeholder={localization.auth.namePlaceholder}
                      required
                      disabled={isPending}
                    />
                  )}
                </form.AppField>

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

                {signUpFields.map((configuredField) => (
                  <form.AppField
                    key={configuredField.name}
                    name={`additionalFields.${configuredField.name}`}
                    validators={getAuthAdditionalFieldValidators(
                      configuredField,
                      localization.auth.fieldRequired,
                    )}
                  >
                    {(field) => (
                      <field.AuthFormAdditionalField
                        field={configuredField}
                        isPending={isPending}
                        optionalLabel={localization.auth.optional}
                      />
                    )}
                  </form.AppField>
                ))}

                <form.AppField
                  name="password"
                  validators={{ onChange: passwordValidator }}
                >
                  {(field) => (
                    <field.AuthFormPasswordField
                      label={localization.auth.password}
                      autoComplete="new-password"
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
                  {localization.auth.signUp}
                </form.AuthFormSubmitButton>
              </FieldGroup>
            </form.AuthFormRoot>
          </form.AppForm>

          {socialProviders && socialProviders.length > 0 && (
            <>
              <FieldSeparator className="*:data-[slot=field-separator-content]:bg-card text-xs flex items-center">
                {localization.auth.or}
              </FieldSeparator>
              <ProviderButtons view="signUp" />
            </>
          )}
        </div>

        <div className="flex flex-col gap-3 items-center w-full mt-4">
          <FieldDescription className="text-center">
            {localization.auth.alreadyHaveAnAccount}{" "}
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
