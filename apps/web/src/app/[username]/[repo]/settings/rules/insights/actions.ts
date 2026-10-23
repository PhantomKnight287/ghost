"use server";

import { z } from "zod";

import { actionClient } from "@/lib/action-client";
import { callApi } from "@/lib/api/server";

const ruleSuiteQuerySchema = z.object({
  rulesetId: z.string().optional(),
  ref: z.string().optional(),
  actor: z.string().optional(),
  result: z.enum(["pass", "fail", "bypass"]).optional(),
  enforcement: z.enum(["active", "evaluate"]).optional(),
  period: z.enum(["hour", "day", "week", "month", "all"]).optional(),
});

export const loadRuleSuites = actionClient
  .inputSchema(
    z.object({
      username: z.string(),
      repo: z.string(),
      query: ruleSuiteQuerySchema,
      cursor: z.string(),
      limit: z.number().int(),
    }),
  )
  .action(({ parsedInput: { username, repo, query, cursor, limit } }) =>
    callApi((client) =>
      client.GET("/api/repositories/{username}/{repo}/rule-suites", {
        params: {
          path: { username, repo },
          query: { ...query, cursor, limit },
        },
      }),
    ),
  );
