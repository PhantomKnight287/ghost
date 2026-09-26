import { createAuthClient } from "better-auth/react";
import { ac, roles } from "@ghost/permissions";
import { organizationClient, usernameClient } from "better-auth/client/plugins";
import { apiKeyClient } from "@better-auth/api-key/client";

import { API_URL } from "@/lib/env";

export const authClient = createAuthClient({
  baseURL: API_URL,
  basePath: "/api/auth",
  plugins: [
    usernameClient(),
    apiKeyClient(),
    // Mirrors the server's organization plugin, so the client knows the same roles.
    organizationClient({
      ac,
      roles,
      teams: { enabled: true },
      dynamicAccessControl: { enabled: true },
    }),
  ],
});
