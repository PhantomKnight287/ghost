"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { KeyRound } from "lucide-react";
import { Fragment } from "react";
import { toast } from "sonner";

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

const QUERY_KEY = ["oauth-apps", "authorized"];

/** Apps holding a token for this account, gh included. Revoking one ends its tokens, and it asks for consent again next time. */
export function AuthorizedAppsSettings() {
  const queryClient = useQueryClient();

  const { data, isPending } = useQuery({
    queryKey: QUERY_KEY,
    queryFn: async () =>
      (await unwrap(apiClient.GET("/api/oauth-apps/authorized"))).apps,
  });

  const revoke = useMutation({
    mutationFn: (clientId: string) =>
      unwrap(
        apiClient.DELETE("/api/oauth-apps/authorized/{clientId}", {
          params: { path: { clientId } },
        }),
      ),
    onSuccess: async () => {
      toast.success("Access revoked");
      await queryClient.invalidateQueries({ queryKey: QUERY_KEY });
    },
    onError: (error: Error) => toast.error(error.message),
  });

  const apps = data ?? [];

  return (
    <div>
      <h2 className="mb-3 text-sm font-semibold">Authorized OAuth apps</h2>

      <Card className="gap-0 p-0">
        <CardContent className="p-0">
          <ItemGroup className="gap-0!">
            {isPending ? (
              <AuthorizedAppRowSkeleton />
            ) : apps.length === 0 ? (
              <Item>
                <ItemContent>
                  <ItemDescription>
                    No app has access to this account.
                  </ItemDescription>
                </ItemContent>
              </Item>
            ) : (
              apps.map((app, index) => (
                <Fragment key={app.clientId}>
                  {index > 0 && <ItemSeparator className="my-0!" />}
                  <Item>
                    <ItemMedia variant="icon">
                      <KeyRound />
                    </ItemMedia>
                    <ItemContent>
                      <ItemTitle>{app.name}</ItemTitle>
                      <ItemDescription className="font-mono text-xs">
                        {app.scopes.length > 0
                          ? app.scopes.join(", ")
                          : "No scopes: public information only"}
                      </ItemDescription>
                      <ItemDescription>
                        Authorized{" "}
                        {new Date(app.authorizedAt).toLocaleDateString()} ·{" "}
                        {app.lastUsedAt
                          ? `Last used ${new Date(app.lastUsedAt).toLocaleDateString()}`
                          : "Never used"}
                      </ItemDescription>
                    </ItemContent>
                    <ItemActions>
                      <Button
                        size="sm"
                        variant="ghost"
                        disabled={revoke.isPending}
                        onClick={() => revoke.mutate(app.clientId)}
                      >
                        Revoke
                      </Button>
                    </ItemActions>
                  </Item>
                </Fragment>
              ))
            )}
          </ItemGroup>
        </CardContent>
      </Card>
    </div>
  );
}

function AuthorizedAppRowSkeleton() {
  return (
    <Item>
      <ItemMedia variant="icon">
        <KeyRound />
      </ItemMedia>
      <ItemContent className="gap-2">
        <Skeleton className="h-4 w-40" />
        <Skeleton className="h-3 w-56" />
      </ItemContent>
    </Item>
  );
}
