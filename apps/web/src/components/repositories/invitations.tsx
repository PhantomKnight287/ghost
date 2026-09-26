"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import Link from "next/link";
import { toast } from "sonner";

import { FromNowHoverCard } from "@/components/from-now-card";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { apiClient, apiErrorMessage } from "@/lib/api/client";
import { authClient } from "@/lib/auth-client";
import { organizationRoleOf } from "@ghost/permissions";

type Kind = "repository" | "organization" | "transfer";

/** One pending invitation: to a repository, to an organization, or to take a repository over. */
type Pending = {
  kind: Kind;
  id: string;
  /** `owner/repo` or the organization's slug, which is also where it lives. */
  name: string;
  /** The role offered, or for a transfer where the repository would go. */
  role: string;
  invitedBy: string | null;
  expiresAt: string | null;
};

/** Pending invitations to collaborate on a repository or to join an organization. Renders nothing when there are none. */
export function Invitations() {
  const queryClient = useQueryClient();

  const { data: repositories = [] } = useQuery({
    queryKey: ["invitations", "repositories"],
    queryFn: async (): Promise<Pending[]> => {
      const { data, error } = await apiClient.GET("/api/invitations");
      if (error) throw new Error(apiErrorMessage(error));
      return data.invitations.map((invitation) => ({
        kind: "repository",
        id: invitation.id,
        name: `${invitation.repository.username}/${invitation.repository.slug}`,
        role: invitation.role,
        invitedBy: invitation.invitedByUsername,
        expiresAt: invitation.expiresAt,
      }));
    },
  });
  const { data: organizations = [] } = useQuery({
    queryKey: ["invitations", "organizations"],
    queryFn: async (): Promise<Pending[]> => {
      const { data, error } = await apiClient.GET(
        "/api/invitations/organizations",
      );
      if (error) throw new Error(apiErrorMessage(error));
      return data.invitations.map((invitation) => ({
        kind: "organization",
        id: invitation.id,
        name: invitation.organization.slug,
        role: organizationRoleOf(invitation.role) ?? "member",
        invitedBy: invitation.invitedByUsername,
        expiresAt: invitation.expiresAt,
      }));
    },
  });

  const { data: transfers = [] } = useQuery({
    queryKey: ["invitations", "transfers"],
    queryFn: async (): Promise<Pending[]> => {
      const { data, error } = await apiClient.GET("/api/transfers");
      if (error) throw new Error(apiErrorMessage(error));
      return data.transfers.map((transfer) => ({
        kind: "transfer",
        id: transfer.repositoryId,
        name: `${transfer.repository.owner}/${transfer.repository.slug}`,
        role: transfer.to,
        invitedBy: transfer.requestedByUsername,
        expiresAt: null,
      }));
    },
  });

  const respond = useMutation({
    mutationFn: async ({
      kind,
      id,
      accept,
    }: {
      kind: Kind;
      id: string;
      accept: boolean;
    }) => {
      const { error } =
        kind === "transfer"
          ? accept
            ? await apiClient.POST("/api/transfers/{repositoryId}/accept", {
                params: { path: { repositoryId: id } },
              })
            : await apiClient.DELETE("/api/transfers/{repositoryId}", {
                params: { path: { repositoryId: id } },
              })
          : kind === "organization"
            ? accept
              ? await authClient.organization.acceptInvitation({
                  invitationId: id,
                })
              : await authClient.organization.rejectInvitation({
                  invitationId: id,
                })
            : accept
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
        queryClient.invalidateQueries({ queryKey: ["invitations"] }),
        // Accepting puts repositories and organizations in the viewer's lists.
        accept &&
          queryClient.invalidateQueries({ queryKey: ["viewer-repositories"] }),
        accept &&
          queryClient.invalidateQueries({ queryKey: ["my-organizations"] }),
      ]),
    onError: (error: Error) => toast.error(error.message),
  });

  const pending = [...transfers, ...organizations, ...repositories];
  if (pending.length === 0) return null;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Invitations</CardTitle>
      </CardHeader>
      <CardContent>
        <ul className="flex flex-col divide-y">
          {pending.map((invitation) => (
            <li
              key={`${invitation.kind}-${invitation.id}`}
              className="flex flex-col gap-2 py-3 first:pt-0 last:pb-0 sm:flex-row sm:items-center"
            >
              <p className="flex-1 text-sm">
                {invitation.invitedBy ?? "Someone"}{" "}
                {invitation.kind === "transfer"
                  ? "wants to transfer "
                  : invitation.kind === "organization"
                    ? "invited you to join "
                    : "invited you to "}
                <Link
                  href={`/${invitation.name}`}
                  className="font-medium text-primary hover:underline"
                >
                  {invitation.name}
                </Link>{" "}
                {invitation.kind === "transfer" ? (
                  <>
                    to <span className="font-medium">{invitation.role}</span>.
                  </>
                ) : (
                  <>
                    {invitation.kind === "organization" ? "as" : "with"}{" "}
                    <span className="font-medium">{invitation.role}</span>
                    {invitation.kind === "organization" ? "." : " access."}
                  </>
                )}{" "}
                {invitation.expiresAt && (
                  <span className="text-muted-foreground">
                    Expires <FromNowHoverCard date={invitation.expiresAt} />.
                  </span>
                )}
              </p>
              <div className="flex gap-2">
                <Button
                  size="sm"
                  disabled={respond.isPending}
                  onClick={() =>
                    respond.mutate({ ...invitation, accept: true })
                  }
                >
                  Accept
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  disabled={respond.isPending}
                  onClick={() =>
                    respond.mutate({ ...invitation, accept: false })
                  }
                >
                  Decline
                </Button>
              </div>
            </li>
          ))}
        </ul>
      </CardContent>
    </Card>
  );
}
