import { createAuthClient } from "better-auth/react";
import { usernameClient } from "better-auth/client/plugins";
import { apiKeyClient } from "@better-auth/api-key/client";

import { API_URL } from "@/lib/env";

export const authClient = createAuthClient({
  baseURL: API_URL,
  basePath: "/api/auth",
  plugins: [usernameClient(), apiKeyClient()],
});
