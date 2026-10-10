"use server";

import { z } from "zod";

import { actionClient } from "@/lib/action-client";
import { callApi } from "@/lib/api/server";

const app = z.object({ clientId: z.string() });
const fields = z.object({
  name: z.string().trim().min(1, "Name the application."),
  description: z.string().trim().max(400),
  homepageUrl: z.string().trim().url("Enter the full homepage URL."),
  callbackUrls: z
    .array(z.string().trim().url("Enter each callback as a full URL."))
    .min(1, "Add at least one callback URL.")
    .max(10, "Add at most 10 callback URLs."),
  deviceFlowEnabled: z.boolean(),
});

export const createOauthApp = actionClient
  .inputSchema(fields)
  .action(({ parsedInput: body }) =>
    callApi((client) => client.POST("/api/oauth-apps", { body })),
  );

export const updateOauthApp = actionClient
  .inputSchema(app.extend(fields.shape))
  .action(async ({ parsedInput: { clientId, ...body } }) => {
    await callApi((client) =>
      client.PATCH("/api/oauth-apps/{clientId}", {
        params: { path: { clientId } },
        body,
      }),
    );
  });

export const rotateOauthAppSecret = actionClient
  .inputSchema(app)
  .action(({ parsedInput: { clientId } }) =>
    callApi((client) =>
      client.POST("/api/oauth-apps/{clientId}/secret", {
        params: { path: { clientId } },
      }),
    ),
  );

export const deleteOauthApp = actionClient
  .inputSchema(app)
  .action(async ({ parsedInput: { clientId } }) => {
    await callApi((client) =>
      client.DELETE("/api/oauth-apps/{clientId}", {
        params: { path: { clientId } },
      }),
    );
  });

export const revokeAuthorizedApp = actionClient
  .inputSchema(app)
  .action(async ({ parsedInput: { clientId } }) => {
    await callApi((client) =>
      client.DELETE("/api/oauth-apps/authorized/{clientId}", {
        params: { path: { clientId } },
      }),
    );
  });
