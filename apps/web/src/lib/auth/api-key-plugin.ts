import { createAuthPlugin } from "@better-auth-ui/core";
import {
  type ApiKeyPluginOptions,
  apiKeyPlugin as coreApiKeyPlugin,
} from "@better-auth-ui/core/plugins/api-key";

import { ApiKeys } from "@/components/auth/api-key/api-keys";
import { OrganizationApiKeys } from "@/components/auth/api-key/organization-api-keys";

/** Ghost calls these personal access tokens - they authenticate git over HTTP. */
const patLocalization: ApiKeyPluginOptions["localization"] = {
  apiKey: "Personal access token",
  apiKeys: "Personal access tokens",
  apiKeysDescription:
    "Create a personal access token to push and pull repositories over HTTP.",
  createApiKey: "Create token",
  noApiKeys: "No personal access tokens",
  newApiKey: "New personal access token",
  newApiKeyWarning:
    "This is the only time you'll see this token. Copy and store it somewhere safe.",
  deleteApiKey: "Delete token",
  deleteApiKeyWarning:
    "This action cannot be undone. Any clone using this token will stop working immediately.",
  dismissNewKey: "I've saved my token",
  editApiKey: "Edit token",
};

export const apiKeyPlugin = createAuthPlugin(
  coreApiKeyPlugin.id,
  (options: ApiKeyPluginOptions = {}) => {
    const core = coreApiKeyPlugin({
      ...options,
      localization: { ...patLocalization, ...options.localization },
    });

    return {
      ...core,
      securityCards: [ApiKeys],
      ...(core.organization
        ? { organizationCards: [OrganizationApiKeys] }
        : {}),
    };
  },
);
