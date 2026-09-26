"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import Link from "next/link";
import { Fragment, useState } from "react";
import { toast } from "sonner";

import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Item,
  ItemActions,
  ItemContent,
  ItemGroup,
  ItemMedia,
  ItemSeparator,
  ItemTitle,
} from "@/components/ui/item";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { apiClient, apiErrorMessage } from "@/lib/api/client";

/** One team's details, shared by the team page and the organization's team settings. */
export function useTeam(organization: string, team: string) {
  return useQuery({
    queryKey: ["organization-team", organization, team],
    queryFn: async () => {
      const { data, error } = await apiClient.GET(
        "/api/organizations/{slug}/teams/{team}",
        { params: { path: { slug: organization, team } } },
      );
      if (error) throw new Error(apiErrorMessage(error));
      return data;
    },
  });
}

/** The organization's members, for picking whom to add. Only members may list them all. */
function useOrganizationMembers(organization: string) {
  return useQuery({
    queryKey: ["organization-members", organization],
    queryFn: async () => {
      const { data, error } = await apiClient.GET("/api/organizations/{slug}", {
        params: { path: { slug: organization } },
      });
      if (error) throw new Error(apiErrorMessage(error));
      return data.members;
    },
  });
}

/** A team's members. Its maintainers and the organization's admins add and remove them; admins also appoint maintainers. */
export function TeamMembers({
  organization,
  team,
  isAdmin,
}: {
  organization: string;
  team: string;
  isAdmin: boolean;
}) {
  const queryClient = useQueryClient();
  const { data } = useTeam(organization, team);
  const { data: members = [] } = useOrganizationMembers(organization);
  const [adding, setAdding] = useState("");

  // Written out per endpoint so openapi-fetch can type each path.
  const send = useMutation({
    mutationFn: async ({
      kind,
      username,
      remove,
    }: {
      kind: "members" | "maintainers";
      username: string;
      remove: boolean;
      done: string;
    }) => {
      const params = { path: { slug: organization, team, username } };
      const { error } =
        kind === "members"
          ? remove
            ? await apiClient.DELETE(
                "/api/organizations/{slug}/teams/{team}/members/{username}",
                { params },
              )
            : await apiClient.PUT(
                "/api/organizations/{slug}/teams/{team}/members/{username}",
                { params },
              )
          : remove
            ? await apiClient.DELETE(
                "/api/organizations/{slug}/teams/{team}/maintainers/{username}",
                { params },
              )
            : await apiClient.PUT(
                "/api/organizations/{slug}/teams/{team}/maintainers/{username}",
                { params },
              );
      if (error) throw new Error(apiErrorMessage(error));
    },
    onSuccess: async (_, { done }) => {
      toast.success(done);
      setAdding("");
      await queryClient.invalidateQueries({
        queryKey: ["organization-team", organization],
      });
      await queryClient.invalidateQueries({
        queryKey: ["organization-teams", organization],
      });
    },
    onError: (error: Error) => toast.error(error.message),
  });

  if (!data) return null;
  const onTeam = new Set(data.members.map((member) => member.username));
  const candidates = members.filter((member) => !onTeam.has(member.username));

  return (
    <div className="flex flex-col">
      {data.members.length === 0 ? (
        <p className="px-4 py-3 text-sm text-muted-foreground">
          Nobody is on this team yet.
        </p>
      ) : (
        <ItemGroup className="gap-0!">
          {data.members.map((member, index) => (
            <Fragment key={member.username}>
              {index > 0 && <ItemSeparator className="my-0!" />}
              <Item size="sm">
                <ItemMedia>
                  <Avatar className="size-7">
                    <AvatarImage src={member.image ?? undefined} alt="" />
                    <AvatarFallback>
                      {member.username.slice(0, 2).toUpperCase()}
                    </AvatarFallback>
                  </Avatar>
                </ItemMedia>
                <ItemContent className="min-w-0">
                  <ItemTitle>
                    <Link
                      href={`/${member.username}`}
                      className="hover:underline"
                    >
                      {member.name}
                    </Link>
                    {member.maintainer && (
                      <Badge variant="outline">Maintainer</Badge>
                    )}
                  </ItemTitle>
                </ItemContent>
                {data.viewerCanManage && (
                  <ItemActions>
                    {isAdmin && (
                      <Button
                        size="sm"
                        variant="ghost"
                        disabled={send.isPending}
                        onClick={() =>
                          send.mutate({
                            kind: "maintainers",
                            username: member.username,
                            remove: member.maintainer,
                            done: member.maintainer
                              ? `${member.name} no longer maintains ${data.name}`
                              : `${member.name} now maintains ${data.name}`,
                          })
                        }
                      >
                        {member.maintainer
                          ? "Remove maintainer"
                          : "Make maintainer"}
                      </Button>
                    )}
                    <Button
                      size="sm"
                      variant="ghost"
                      disabled={send.isPending}
                      onClick={() =>
                        send.mutate({
                          kind: "members",
                          username: member.username,
                          remove: true,
                          done: `${member.name} left ${data.name}`,
                        })
                      }
                    >
                      Remove
                    </Button>
                  </ItemActions>
                )}
              </Item>
            </Fragment>
          ))}
        </ItemGroup>
      )}

      {data.viewerCanManage && candidates.length > 0 && (
        <div className="flex flex-col gap-2 border-t p-4 sm:flex-row">
          <Select value={adding} onValueChange={setAdding}>
            <SelectTrigger
              aria-label={`Member to add to ${data.name}`}
              className="w-full sm:flex-1"
            >
              <SelectValue placeholder="Add a member" />
            </SelectTrigger>
            <SelectContent>
              {candidates.map((member) => (
                <SelectItem key={member.username} value={member.username}>
                  {member.name} ({member.username})
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Button
            size="sm"
            variant="outline"
            disabled={send.isPending || !adding}
            onClick={() =>
              send.mutate({
                kind: "members",
                username: adding,
                remove: false,
                done: `Added to ${data.name}`,
              })
            }
          >
            Add
          </Button>
        </div>
      )}
    </div>
  );
}
