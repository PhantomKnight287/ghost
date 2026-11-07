"use server";

import { z } from "zod";

import { actionClient } from "@/lib/action-client";
import { callApi } from "@/lib/api/server";

const repository = z.object({ username: z.string(), repo: z.string() });

export const rerunCheckRun = actionClient
  .inputSchema(repository.extend({ id: z.string() }))
  .action(async ({ parsedInput: { username, repo, id } }) => {
    await callApi((client) =>
      client.POST(
        "/api/repositories/{username}/{repo}/check-runs/{id}/rerequest",
        { params: { path: { username, repo, id } } },
      ),
    );
  });

export const rerunCheckSuite = actionClient
  .inputSchema(repository.extend({ id: z.string() }))
  .action(async ({ parsedInput: { username, repo, id } }) => {
    await callApi((client) =>
      client.POST(
        "/api/repositories/{username}/{repo}/check-suites/{id}/rerequest",
        { params: { path: { username, repo, id } } },
      ),
    );
  });

export const pressCheckAction = actionClient
  .inputSchema(repository.extend({ id: z.string(), identifier: z.string() }))
  .action(async ({ parsedInput: { username, repo, id, identifier } }) => {
    await callApi((client) =>
      client.POST(
        "/api/repositories/{username}/{repo}/check-runs/{id}/actions/{identifier}",
        { params: { path: { username, repo, id, identifier } } },
      ),
    );
  });

export const loadCheckAnnotations = actionClient
  .inputSchema(repository.extend({ id: z.string(), offset: z.number() }))
  .action(async ({ parsedInput: { username, repo, id, offset } }) =>
    callApi((client) =>
      client.GET(
        "/api/repositories/{username}/{repo}/check-runs/{id}/annotations",
        { params: { path: { username, repo, id }, query: { offset } } },
      ),
    ),
  );
