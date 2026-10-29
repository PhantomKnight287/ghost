"use server";

import { z } from "zod";

import { actionClient } from "@/lib/action-client";
import { callApi } from "@/lib/api/server";

const selection = z.object({
  repositorySelection: z.enum(["all", "selected"]),
  repositoryIds: z.array(z.string()),
});
const installation = z.object({ id: z.string() });

/** `selected` sends its repositories; `all` sends none. */
const body = ({
  repositorySelection,
  repositoryIds,
}: z.infer<typeof selection>) =>
  repositorySelection === "selected"
    ? { repositorySelection, repositoryIds }
    : { repositorySelection };

export const installApp = actionClient
  .inputSchema(selection.extend({ slug: z.string(), account: z.string() }))
  .action(({ parsedInput: { slug, account, ...values } }) =>
    callApi((client) =>
      client.POST("/api/apps/{slug}/installations", {
        params: { path: { slug } },
        body: { account, ...body(values) },
      }),
    ),
  );

export const updateInstallation = actionClient
  .inputSchema(installation.extend(selection.shape))
  .action(async ({ parsedInput: { id, ...values } }) => {
    await callApi((client) =>
      client.PATCH("/api/installations/{id}", {
        params: { path: { id } },
        body: body(values),
      }),
    );
  });

export const setSuspended = actionClient
  .inputSchema(installation.extend({ suspended: z.boolean() }))
  .action(async ({ parsedInput: { id, suspended } }) => {
    await callApi((client) =>
      suspended
        ? client.PUT("/api/installations/{id}/suspended", {
            params: { path: { id } },
          })
        : client.DELETE("/api/installations/{id}/suspended", {
            params: { path: { id } },
          }),
    );
  });

export const uninstallApp = actionClient
  .inputSchema(installation)
  .action(async ({ parsedInput: { id } }) => {
    await callApi((client) =>
      client.DELETE("/api/installations/{id}", { params: { path: { id } } }),
    );
  });
