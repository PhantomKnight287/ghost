import createFetchClient from "openapi-fetch";
import createClient from "openapi-react-query";

import { API_URL } from "@/lib/env";

import type { paths } from "@/lib/api/v1";

export const fetchClient = createFetchClient<paths>({
  baseUrl: API_URL,
  credentials: "include",
});

export const api = createClient(fetchClient);
