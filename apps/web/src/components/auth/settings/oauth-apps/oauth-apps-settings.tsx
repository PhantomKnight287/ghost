"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { AppWindow } from "lucide-react";
import { Fragment, useState } from "react";
import { toast } from "sonner";

import { SecretAlert } from "@/components/secret-alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import {
  Item,
  ItemActions,
  ItemContent,
  ItemDescription,
  ItemGroup,
  ItemMedia,
  ItemSeparator,
  ItemTitle,
} from "@/components/ui/item";
import { Skeleton } from "@/components/ui/skeleton";
import { apiClient, unwrap } from "@/lib/api/client";
import { DeleteOauthAppDialog } from "./delete-oauth-app-dialog";
import { EditOauthAppDialog } from "./edit-oauth-app-dialog";
import { OauthAppFields, type OauthAppValues } from "./oauth-app-fields";

const QUERY_KEY = ["oauth-apps"];

const EMPTY: OauthAppValues = {
  name: "",
  homepageUrl: "",
  callbackUrl: "",
  deviceFlowEnabled: false,
};

type Secret = { name: string; clientId: string; clientSecret: string };

/** OAuth apps this account registered, so third-party tools can sign its users in to Ghost as they would to GitHub. */
export function OauthAppsSettings() {
  const queryClient = useQueryClient();
  const [draft, setDraft] = useState(EMPTY);
  const [secret, setSecret] = useState<Secret | null>(null);
  const [editing, setEditing] = useState<string | null>(null);
  const [deleting, setDeleting] = useState<string | null>(null);

  const { data, isPending } = useQuery({
    queryKey: QUERY_KEY,
    queryFn: async () => (await unwrap(apiClient.GET("/api/oauth-apps"))).apps,
  });

  const create = useMutation({
    mutationFn: () =>
      unwrap(apiClient.POST("/api/oauth-apps", { body: draft })),
    onSuccess: async (app) => {
      setDraft(EMPTY);
      setSecret(app);
      await queryClient.invalidateQueries({ queryKey: QUERY_KEY });
    },
    onError: (error: Error) => toast.error(error.message),
  });

  const rotate = useMutation({
    mutationFn: async (app: { clientId: string; name: string }) => {
      const { clientSecret } = await unwrap(
        apiClient.POST("/api/oauth-apps/{clientId}/secret", {
          params: { path: { clientId: app.clientId } },
        }),
      );
      return { ...app, clientSecret };
    },
    onSuccess: setSecret,
    onError: (error: Error) => toast.error(error.message),
  });

  const apps = data ?? [];

  return (
    <div className="flex flex-col gap-3">
      <h2 className="text-sm font-semibold">OAuth apps</h2>

      {secret && (
        <SecretAlert
          title={`Copy the client secret for ${secret.name} now`}
          description={
            <>
              Ghost will not show it again. The client ID is{" "}
              <code className="font-mono text-xs">{secret.clientId}</code>.
            </>
          }
          secret={secret.clientSecret}
        />
      )}

      <Card className="gap-0 p-0">
        <CardContent className="p-0">
          <ItemGroup className="gap-0!">
            {isPending ? (
              <OauthAppRowSkeleton />
            ) : apps.length === 0 ? (
              <Item>
                <ItemContent>
                  <ItemDescription>
                    No OAuth apps yet. Register one to let a tool sign users in
                    with Ghost.
                  </ItemDescription>
                </ItemContent>
              </Item>
            ) : (
              apps.map((app, index) => (
                <Fragment key={app.clientId}>
                  {index > 0 && <ItemSeparator className="my-0!" />}
                  <Item>
                    <ItemMedia variant="icon">
                      <AppWindow />
                    </ItemMedia>
                    <ItemContent>
                      <ItemTitle>
                        {app.name}
                        {app.deviceFlowEnabled && (
                          <Badge variant="secondary">Device flow</Badge>
                        )}
                      </ItemTitle>
                      <ItemDescription className="font-mono text-xs">
                        {app.clientId}
                      </ItemDescription>
                      <ItemDescription className="truncate">
                        {app.callbackUrl}
                      </ItemDescription>
                    </ItemContent>
                    <ItemActions>
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => setEditing(app.clientId)}
                      >
                        Edit
                      </Button>
                      <Button
                        size="sm"
                        variant="ghost"
                        disabled={rotate.isPending}
                        onClick={() => rotate.mutate(app)}
                      >
                        New secret
                      </Button>
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => setDeleting(app.clientId)}
                      >
                        Delete
                      </Button>
                    </ItemActions>
                  </Item>
                  <EditOauthAppDialog
                    app={app}
                    open={editing === app.clientId}
                    onOpenChange={(open) =>
                      setEditing(open ? app.clientId : null)
                    }
                  />
                  <DeleteOauthAppDialog
                    app={app}
                    open={deleting === app.clientId}
                    onOpenChange={(open) =>
                      setDeleting(open ? app.clientId : null)
                    }
                  />
                </Fragment>
              ))
            )}
          </ItemGroup>
        </CardContent>

        <form
          className="flex flex-col gap-4 border-t p-4"
          onSubmit={(event) => {
            event.preventDefault();
            create.mutate();
          }}
        >
          <OauthAppFields
            idPrefix="new-oauth-app"
            values={draft}
            disabled={create.isPending}
            onChange={setDraft}
          />
          <Button
            type="submit"
            size="sm"
            className="self-end"
            disabled={create.isPending}
          >
            Register application
          </Button>
        </form>
      </Card>
    </div>
  );
}

function OauthAppRowSkeleton() {
  return (
    <Item>
      <ItemMedia variant="icon">
        <AppWindow />
      </ItemMedia>
      <ItemContent className="gap-2">
        <Skeleton className="h-4 w-40" />
        <Skeleton className="h-3 w-56" />
      </ItemContent>
    </Item>
  );
}
