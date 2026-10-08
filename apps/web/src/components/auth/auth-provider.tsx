import {
  AuthProvider as AuthProviderPrimitive,
  type AuthProviderProps,
} from "@better-auth-ui/react";
import type {
  ComponentPropsWithoutRef,
  ComponentType,
  PropsWithChildren,
  ReactNode,
} from "react";

import { ErrorToaster } from "./error-toaster";

declare module "@better-auth-ui/core" {
  interface AuthConfig {
    Link: ComponentType<
      PropsWithChildren<
        { className?: string; href: string; to?: string } & Pick<
          ComponentPropsWithoutRef<"a">,
          "aria-disabled" | "tabIndex" | "onClick"
        >
      >
    >;
  }

  /** Widen `AdditionalField.label` to `ReactNode` in the shadcn package. */
  interface AdditionalFieldRegister {
    label: ReactNode;
  }
}

export function AuthProvider({ children, ...config }: AuthProviderProps) {
  return (
    <AuthProviderPrimitive {...config}>
      {children}

      <ErrorToaster />
    </AuthProviderPrimitive>
  );
}
