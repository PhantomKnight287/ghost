"use server";

import { z } from "zod";

import { actionClient } from "@/lib/action-client";
import { callApi } from "@/lib/api/server";

import { callbackUrlsOf } from "./callback-urls";

const app = z.object({ slug: z.string() });
const optionalUrl = z
  .string()
  .trim()
  .url("Enter the full URL, starting with https://")
  .or(z.literal(""));
const fields = z.object({
  name: z.string().trim().min(1, "Name the app.").max(34),
  description: z.string().trim().max(400),
  homepageUrl: z.string().trim().url("Enter the full homepage URL."),
  setupUrl: optionalUrl,
  webhookUrl: optionalUrl,
  webhookSecret: z.string(),
  callbackUrls: z.string(),
  expireUserTokens: z.boolean(),
  deviceFlowEnabled: z.boolean(),
  requestOauthOnInstall: z.boolean(),
  permissions: z.record(z.string(), z.enum(["read", "write"])),
  events: z.array(z.string()),
});

/** Empty text fields clear a setting; an empty secret leaves the stored one alone. */
const body = ({
  webhookSecret,
  callbackUrls,
  ...values
}: z.infer<typeof fields>) => ({
  ...values,
  callbackUrls: callbackUrlsOf({ callbackUrls }),
  description: values.description || null,
  setupUrl: values.setupUrl || null,
  webhookUrl: values.webhookUrl || null,
  ...(webhookSecret && { webhookSecret }),
});

export const createApp = actionClient
  .inputSchema(fields.extend({ organization: z.string().optional() }))
  .action(({ parsedInput: { organization, ...values } }) =>
    callApi((client) =>
      organization
        ? client.POST("/api/organizations/{slug}/apps", {
            params: { path: { slug: organization } },
            body: body(values),
          })
        : client.POST("/api/apps", { body: body(values) }),
    ),
  );

export const updateApp = actionClient
  .inputSchema(app.extend(fields.shape))
  .action(async ({ parsedInput: { slug, ...values } }) => {
    await callApi((client) =>
      client.PATCH("/api/apps/{slug}", {
        params: { path: { slug } },
        body: body(values),
      }),
    );
  });

export const setAppWebhookActive = actionClient
  .inputSchema(app.extend({ active: z.boolean() }))
  .action(async ({ parsedInput: { slug, active } }) => {
    await callApi((client) =>
      client.PATCH("/api/apps/{slug}", {
        params: { path: { slug } },
        body: { webhookActive: active },
      }),
    );
  });

export const createClientSecret = actionClient
  .inputSchema(app)
  .action(({ parsedInput: { slug } }) =>
    callApi((client) =>
      client.POST("/api/apps/{slug}/client-secrets", {
        params: { path: { slug } },
      }),
    ),
  );

export const deleteClientSecret = actionClient
  .inputSchema(app.extend({ id: z.string() }))
  .action(async ({ parsedInput: { slug, id } }) => {
    await callApi((client) =>
      client.DELETE("/api/apps/{slug}/client-secrets/{id}", {
        params: { path: { slug, id } },
      }),
    );
  });

export const deleteApp = actionClient
  .inputSchema(app)
  .action(async ({ parsedInput: { slug } }) => {
    await callApi((client) =>
      client.DELETE("/api/apps/{slug}", { params: { path: { slug } } }),
    );
  });

export const createPrivateKey = actionClient
  .inputSchema(app)
  .action(({ parsedInput: { slug } }) =>
    callApi((client) =>
      client.POST("/api/apps/{slug}/private-keys", {
        params: { path: { slug } },
      }),
    ),
  );

export const deletePrivateKey = actionClient
  .inputSchema(app.extend({ id: z.string() }))
  .action(async ({ parsedInput: { slug, id } }) => {
    await callApi((client) =>
      client.DELETE("/api/apps/{slug}/private-keys/{id}", {
        params: { path: { slug, id } },
      }),
    );
  });
