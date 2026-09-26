"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import Link from "next/link";
import { toast } from "sonner";

import { FromNowHoverCard } from "@/components/from-now-card";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { apiClient, apiErrorMessage } from "@/lib/api/client";

const QUERY_KEY = ["invitations"];

/** Pending invitations to collaborate. Renders nothing when there are none. */
export function Invitations() {
  const queryClient = useQueryClient();

  const { data } = useQuery({
    queryKey: QUERY_KEY,
    queryFn: async () => {
      const { data, error } = await apiClient.GET("/api/invitations");
      if (error) throw new Error(apiErrorMessage(error));
      return data.invitations;
    },
  });

  const respond = useMutation({
    mutationFn: async ({ id, accept }: { id: string; accept: boolean }) => {
      const { error } = accept
        ? await apiClient.POST("/api/invitations/{id}/accept", {
            params: { path: { id } },
          })
        : await apiClient.DELETE("/api/invitations/{id}", {
            params: { path: { id } },
          });
      if (error) throw new Error(apiErrorMessage(error));
    },
    onSuccess: (_, { accept }) =>
      Promise.all([
        queryClient.invalidateQueries({ queryKey: QUERY_KEY }),
        accept &&
          queryClient.invalidateQueries({ queryKey: ["viewer-repositories"] }),
      ]),
    onError: (error: Error) => toast.error(error.message),
  });

  if (!data?.length) return null;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Invitations</CardTitle>
      </CardHeader>
      <CardContent>
        <ul className="flex flex-col divide-y">
          {data.map((invitation) => {
            const fullName = `${invitation.repository.username}/${invitation.repository.slug}`;
            return (
              <li
                key={invitation.id}
                className="flex flex-col gap-2 py-3 first:pt-0 last:pb-0 sm:flex-row sm:items-center"
              >
                <p className="flex-1 text-sm">
                  {invitation.invitedByUsername ?? "Someone"} invited you to{" "}
                  <Link
                    href={`/${fullName}`}
                    className="font-medium text-primary hover:underline"
                  >
                    {fullName}
                  </Link>{" "}
                  with <span className="font-medium">{invitation.role}</span>{" "}
                  access.{" "}
                  <span className="text-muted-foreground">
                    Expires <FromNowHoverCard date={invitation.expiresAt} />.
                  </span>
                </p>
                <div className="flex gap-2">
                  <Button
                    size="sm"
                    disabled={respond.isPending}
                    onClick={() =>
                      respond.mutate({ id: invitation.id, accept: true })
                    }
                  >
                    Accept
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={respond.isPending}
                    onClick={() =>
                      respond.mutate({ id: invitation.id, accept: false })
                    }
                  >
                    Decline
                  </Button>
                </div>
              </li>
            );
          })}
        </ul>
      </CardContent>
    </Card>
  );
}
