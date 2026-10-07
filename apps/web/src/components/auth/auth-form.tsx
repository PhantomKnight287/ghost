"use client";

import {
  type AdditionalField as AdditionalFieldConfig,
  type AdditionalFieldFormValue,
  DEFAULT_ADDITIONAL_FIELD_VALIDATION_DEBOUNCE_MS,
  getFormFieldErrors,
  normalizeAuthFormServerError,
  validateAdditionalFieldRequired,
  validateAdditionalFieldValue,
  validateStringLength,
} from "@better-auth-ui/core";
import { useAuth } from "@better-auth-ui/react";
import {
  type AnyFormApi,
  createFormHook,
  createFormHookContexts,
} from "@tanstack/react-form";
import { Eye, EyeOff } from "lucide-react";
import {
  type ComponentProps,
  type FormEvent,
  type ReactNode,
  useRef,
  useState,
} from "react";

import { Button } from "@/components/ui/button";
import {
  Field,
  FieldDescription,
  FieldError,
  FieldLabel,
} from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import {
  InputGroup,
  InputGroupAddon,
  InputGroupButton,
  InputGroupInput,
} from "@/components/ui/input-group";
import { Skeleton } from "@/components/ui/skeleton";
import { Spinner } from "@/components/ui/spinner";
import { AdditionalField, type AdditionalFieldProps } from "./additional-field";

const { fieldContext, formContext, useFieldContext, useFormContext } =
  createFormHookContexts();

const DEFAULT_AUTH_FORM_SERVER_ERROR = "Unable to submit this form. Try again.";

function focusFirstInvalidAuthFormControl(form: HTMLFormElement) {
  requestAnimationFrame(() => {
    form
      .querySelector<HTMLElement>(
        '[aria-invalid="true"]:not([disabled]), :invalid:not([disabled])',
      )
      ?.focus();
  });
}

function AuthFormFieldError() {
  const field = useFieldContext<unknown>();
  const isInvalid = field.state.meta.isTouched && !field.state.meta.isValid;

  if (!isInvalid) return null;

  const errors = getFormFieldErrors(field.state.meta.errors);

  return errors.length > 0 ? <FieldError errors={errors} /> : null;
}

function setAuthFormServerError(
  form: AnyFormApi,
  error: unknown,
  fallbackMessage: string,
) {
  const normalized = normalizeAuthFormServerError(error, fallbackMessage);
  form.setErrorMap({
    onServer: {
      fields: normalized.fields ?? {},
      form: normalized.form,
    },
  });
}

function clearAuthFormServerError(form: AnyFormApi) {
  form.setErrorMap({ onServer: { fields: {} } });
}

function clearAuthFormFieldServerError(form: AnyFormApi, fieldName: string) {
  form.setErrorMap({ onServer: undefined });
  if (!fieldName) return;

  const fieldMeta = form.getFieldMeta(fieldName as never);
  if (!fieldMeta?.errorMap.onServer) return;

  form.setFieldMeta(fieldName as never, (current = fieldMeta) => ({
    ...current,
    errorMap: { ...current.errorMap, onServer: undefined },
    errorSourceMap: { ...current.errorSourceMap, onServer: undefined },
  }));
}

async function submitAuthForm(
  form: AnyFormApi,
  serverErrorMessage = DEFAULT_AUTH_FORM_SERVER_ERROR,
) {
  clearAuthFormServerError(form);
  try {
    await form.handleSubmit();
    return form.state.isValid;
  } catch (error) {
    if (!form.state.errorMap.onServer) {
      setAuthFormServerError(form, error, serverErrorMessage);
    }
    return false;
  }
}

type AuthFormRootProps = Omit<ComponentProps<"form">, "onSubmit"> & {
  onBeforeSubmit?: () => void;
  serverErrorMessage?: string;
};

function AuthFormRoot({
  children,
  onBeforeSubmit,
  onInput,
  serverErrorMessage = DEFAULT_AUTH_FORM_SERVER_ERROR,
  ...props
}: AuthFormRootProps) {
  const form = useFormContext();
  const submittingRef = useRef(false);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (submittingRef.current || form.state.isSubmitting) return;

    const formElement = event.currentTarget;
    onBeforeSubmit?.();
    submittingRef.current = true;
    try {
      const isValid = await submitAuthForm(form, serverErrorMessage);
      if (!isValid) focusFirstInvalidAuthFormControl(formElement);
    } finally {
      submittingRef.current = false;
    }
  }

  return (
    <form
      {...props}
      onInvalid={(event) =>
        focusFirstInvalidAuthFormControl(event.currentTarget)
      }
      onInput={(event) => {
        const target = event.target;
        const fieldName =
          target instanceof HTMLInputElement ||
          target instanceof HTMLSelectElement ||
          target instanceof HTMLTextAreaElement
            ? target.name
            : "";
        clearAuthFormFieldServerError(form, fieldName);
        onInput?.(event);
      }}
      onSubmit={submit}
    >
      {children}
    </form>
  );
}

type AuthFormTextFieldProps = Omit<
  ComponentProps<typeof Input>,
  "name" | "onBlur" | "onChange" | "value"
> & {
  description?: ReactNode;
  label: ReactNode;
};

function AuthFormTextField({
  description,
  id,
  label,
  ...props
}: AuthFormTextFieldProps) {
  const field = useFieldContext<string>();
  const form = useFormContext();
  const isInvalid = isAuthFormFieldInvalid(field.state.meta);
  const inputId = id ?? field.name;

  return (
    <Field data-invalid={isInvalid}>
      <FieldLabel htmlFor={inputId}>{label}</FieldLabel>
      <Input
        {...props}
        aria-busy={field.state.meta.isValidating || undefined}
        aria-invalid={isInvalid}
        id={inputId}
        name={field.name}
        onBlur={field.handleBlur}
        onChange={(event) => {
          clearAuthFormFieldServerError(form, field.name);
          field.handleChange(event.target.value);
        }}
        value={field.state.value}
      />
      {description ? <FieldDescription>{description}</FieldDescription> : null}
      <AuthFormFieldError />
    </Field>
  );
}

type AuthFormPasswordFieldProps = {
  label: ReactNode;
  autoComplete: string;
  placeholder?: string;
  disabled?: boolean;
  /** Shows a skeleton in place of the input while what the form acts on loads. */
  isLoading?: boolean;
  /** Replaces the field's own errors, for a server verdict on the password such as a breach. */
  error?: ReactNode;
  onValueChange?: () => void;
  children?: ReactNode;
};

function AuthFormPasswordField({
  label,
  autoComplete,
  placeholder,
  disabled,
  isLoading,
  error,
  onValueChange,
  children,
}: AuthFormPasswordFieldProps) {
  const field = useFieldContext<string>();
  const form = useFormContext();
  const { emailAndPassword, localization } = useAuth();
  const [isVisible, setIsVisible] = useState(false);
  const isInvalid = isAuthFormFieldInvalid(field.state.meta) || Boolean(error);
  const toggleLabel = isVisible
    ? localization.auth.hidePassword
    : localization.auth.showPassword;

  return (
    <Field data-invalid={isInvalid}>
      <FieldLabel htmlFor={field.name}>{label}</FieldLabel>
      {isLoading ? (
        <Skeleton>
          <Input className="invisible" />
        </Skeleton>
      ) : (
        <InputGroup>
          <InputGroupInput
            id={field.name}
            name={field.name}
            type={isVisible ? "text" : "password"}
            autoComplete={autoComplete}
            value={field.state.value}
            onBlur={field.handleBlur}
            onChange={(event) => {
              clearAuthFormFieldServerError(form, field.name);
              field.handleChange(event.target.value);
              onValueChange?.();
            }}
            placeholder={placeholder ?? localization.auth.passwordPlaceholder}
            required
            minLength={emailAndPassword.minPasswordLength}
            maxLength={emailAndPassword.maxPasswordLength}
            disabled={disabled}
            aria-invalid={isInvalid}
          />
          <InputGroupAddon align="inline-end">
            <InputGroupButton
              size="icon-xs"
              aria-label={toggleLabel}
              title={toggleLabel}
              onClick={() => setIsVisible((visible) => !visible)}
            >
              {isVisible ? <EyeOff /> : <Eye />}
            </InputGroupButton>
          </InputGroupAddon>
        </InputGroup>
      )}
      {error ? <FieldError>{error}</FieldError> : <AuthFormFieldError />}
      {children}
    </Field>
  );
}

/** Validates a password against the configured length limits. */
export function usePasswordValidator() {
  const { emailAndPassword, localization } = useAuth();
  const { minPasswordLength, maxPasswordLength } = emailAndPassword;

  return ({ value }: { value: string }) =>
    validateStringLength(value, {
      maxLength: maxPasswordLength,
      maxLengthMessage: localization.auth.tooLong.replace(
        "{{max}}",
        String(maxPasswordLength),
      ),
      minLength: minPasswordLength,
      minLengthMessage: localization.auth.tooShort.replace(
        "{{min}}",
        String(minPasswordLength),
      ),
      requiredMessage: localization.auth.fieldRequired,
    });
}

function AuthFormSubmitButton({
  children,
  disabled,
  isPending,
  ...props
}: ComponentProps<typeof Button> & { isPending?: boolean }) {
  const form = useFormContext();

  return (
    <form.Subscribe
      selector={(state) => [state.isSubmitting, state.isValidating] as const}
    >
      {([isSubmitting, isValidating]) => (
        <Button
          {...props}
          aria-busy={isPending || isSubmitting || undefined}
          aria-disabled={
            disabled || isPending || isSubmitting || isValidating || undefined
          }
          disabled={disabled || isPending || isSubmitting || isValidating}
          type="submit"
        >
          {isPending || isSubmitting ? (
            <Spinner data-icon="inline-start" />
          ) : null}
          {children}
        </Button>
      )}
    </form.Subscribe>
  );
}

type AuthFormAdditionalFieldProps = Omit<
  AdditionalFieldProps,
  "errors" | "isInvalid" | "name" | "onBlur" | "onChange" | "value"
>;

function AuthFormAdditionalField(props: AuthFormAdditionalFieldProps) {
  const field = useFieldContext<AdditionalFieldFormValue>();
  const form = useFormContext();
  const isInvalid = isAuthFormFieldInvalid(field.state.meta);

  return (
    <AdditionalField
      {...props}
      errors={
        isInvalid ? getFormFieldErrors(field.state.meta.errors) : undefined
      }
      isInvalid={isInvalid}
      name={field.name}
      onBlur={field.handleBlur}
      onChange={(value) => {
        clearAuthFormFieldServerError(form, field.name);
        field.handleChange(value);
      }}
      value={field.state.value}
    />
  );
}

export const { useAppForm: useAuthForm } = createFormHook({
  fieldComponents: {
    AuthFormAdditionalField,
    AuthFormFieldError,
    AuthFormPasswordField,
    AuthFormTextField,
  },
  fieldContext,
  formComponents: {
    AuthFormRoot,
    AuthFormSubmitButton,
  },
  formContext,
});

export function isAuthFormFieldInvalid({
  isTouched,
  isValid,
}: {
  isTouched: boolean;
  isValid: boolean;
}) {
  return isTouched && !isValid;
}

export function getAuthAdditionalFieldValidators(
  field: AdditionalFieldConfig,
  requiredMessage: string,
) {
  return {
    onChange: ({ value }: { value: AdditionalFieldFormValue }) =>
      validateAdditionalFieldRequired(field, value, requiredMessage),
    onChangeAsync: field.validate
      ? ({ value }: { value: AdditionalFieldFormValue }) =>
          validateAdditionalFieldValue(field, value)
      : undefined,
    onChangeAsyncDebounceMs: field.validate
      ? (field.validateDebounceMs ??
        DEFAULT_ADDITIONAL_FIELD_VALIDATION_DEBOUNCE_MS)
      : undefined,
  };
}
