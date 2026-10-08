import { createAuthPlugin } from "@better-auth-ui/core";
import {
  usernamePlugin as coreUsernamePlugin,
  type UsernamePluginOptions,
} from "@better-auth-ui/core/plugins/username";

import { SignInUsername } from "@/components/auth/username/sign-in-username";
import { UsernameField } from "@/components/auth/username/username-field";

export const usernamePlugin = createAuthPlugin(
  coreUsernamePlugin.id,
  (options: UsernamePluginOptions = {}) => {
    const core = coreUsernamePlugin(options);
    const withRenderer = (fields: typeof core.additionalFields) =>
      fields?.map((field) =>
        field.name === "username" ? { ...field, render: UsernameField } : field,
      );

    return {
      ...core,
      additionalFields: withRenderer(core.additionalFields),
      // The core resolver rebuilds the fields from the localization once the config resolves, dropping `render`.
      _localizationResolver: (
        ...args: Parameters<typeof core._localizationResolver>
      ) => {
        const resolved = core._localizationResolver(...args);
        return {
          ...resolved,
          additionalFields: withRenderer(resolved.additionalFields),
        };
      },
      views: {
        auth: { signIn: SignInUsername },
      },
    };
  },
);
