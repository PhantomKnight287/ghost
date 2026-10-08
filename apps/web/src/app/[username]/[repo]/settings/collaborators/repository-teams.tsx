"use client";

import { Users } from "lucide-react";
import { useRouter } from "next/navigation";
import { useAction } from "next-safe-action/hooks";
import { Fragment } from "react";
import { toast } from "sonner";

import { RoleSelect } from "@/components/role-select";
import { Card } from "@/components/ui/card";
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty";
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
import type { components } from "@/lib/api/v1";
import {
  type CollaboratorRole,
  collaboratorRoles,
  roleLabels,
} from "@/lib/repository-role";

import {
  removeTeamAccess,
  setTeamRole,
} from "@/components/repositories/actions";

type Team = components["schemas"]["RepositoryTeamDTO"];

const NO_ACCESS = "none" as const;

/** Every team in the organization, each with a role here or none. Choosing a role grants it to all of the team's members. */
export function RepositoryTeams({
  username,
  slug,
  teams,
}: {
  username: string;
  slug: string;
  teams: Team[];
}) {
  const router = useRouter();
  const callbacks = {
    onSuccess: () => router.refresh(),
    onError: ({ error }: { error: { serverError?: string } }) =>
      toast.error(error.serverError ?? "Could not change this team's access."),
  };
  const grant = useAction(setTeamRole, callbacks);
  const revoke = useAction(removeTeamAccess, callbacks);
  const busy = grant.isExecuting || revoke.isExecuting;

  return (
    <section>
      <h2 className="mb-3 text-sm font-semibold">Teams</h2>
      <Card className="py-0">
        {teams.length === 0 ? (
          <Empty className="py-10">
            <EmptyHeader>
              <EmptyMedia variant="icon">
                <Users />
              </EmptyMedia>
              <EmptyTitle>No teams yet</EmptyTitle>
              <EmptyDescription>
                Teams created in the organization&apos;s settings show up here.
              </EmptyDescription>
            </EmptyHeader>
          </Empty>
        ) : (
          <ItemGroup className="gap-0!">
            {teams.map((team, index) => (
              <Fragment key={team.id}>
                {index > 0 && <ItemSeparator className="my-0!" />}
                <Item>
                  <ItemMedia variant="icon">
                    <Users />
                  </ItemMedia>
                  <ItemContent>
                    <ItemTitle>{team.name}</ItemTitle>
                    <ItemDescription>
                      {team.memberCount === 1
                        ? "1 member"
                        : `${team.memberCount} members`}
                    </ItemDescription>
                  </ItemContent>
                  <ItemActions>
                    <RoleSelect<CollaboratorRole | typeof NO_ACCESS>
                      label={`Access for ${team.name}`}
                      roles={[NO_ACCESS, ...collaboratorRoles]}
                      labels={{ ...roleLabels, [NO_ACCESS]: "No access" }}
                      value={team.role ?? NO_ACCESS}
                      disabled={busy}
                      onChange={(next) =>
                        next === NO_ACCESS
                          ? revoke.execute({ username, slug, teamId: team.id })
                          : grant.execute({
                              username,
                              slug,
                              teamId: team.id,
                              role: next,
                            })
                      }
                    />
                  </ItemActions>
                </Item>
              </Fragment>
            ))}
          </ItemGroup>
        )}
      </Card>
    </section>
  );
}
