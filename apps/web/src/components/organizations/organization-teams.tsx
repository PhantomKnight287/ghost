"use client";

import { useQuery, useQueryClient } from "@tanstack/react-query";
import { UsersRound } from "lucide-react";
import Link from "next/link";
import { useState } from "react";

import { SettingCard } from "@/components/repositories/setting-card";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty";
import { Field, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import {
  Item,
  ItemActions,
  ItemContent,
  ItemDescription,
  ItemMedia,
  ItemTitle,
} from "@/components/ui/item";
import { apiClient, apiErrorMessage } from "@/lib/api/client";
import { authClient } from "@/lib/auth-client";

import { TeamMembers } from "./team-members";
import { useOrganization } from "./use-organization";

/** Teams in the organization's settings: create and delete them, and manage who is on each. */
export function OrganizationTeams({ slug }: { slug: string }) {
  const queryClient = useQueryClient();
  const { organization, change, busy } = useOrganization(slug);
  const [name, setName] = useState("");

  const { data: teams = [] } = useQuery({
    queryKey: ["organization-teams", slug],
    queryFn: async () => {
      const { data, error } = await apiClient.GET(
        "/api/organizations/{slug}/teams",
        { params: { path: { slug } } },
      );
      if (error) throw new Error(apiErrorMessage(error));
      return data.teams;
    },
  });
  const refresh = () =>
    queryClient.invalidateQueries({ queryKey: ["organization-teams", slug] });

  return (
    <div className="flex flex-col gap-8">
      <SettingCard
        title="Create a team"
        hint="Give a team a role on a repository from that repository's Access settings."
        onSubmit={() =>
          change(
            () =>
              authClient.organization.createTeam({
                organizationId: organization?.id,
                name: name.trim(),
              }),
            `Team ${name.trim()} created`,
          ).then((ok) => {
            if (!ok) return;
            setName("");
            return refresh();
          })
        }
        pending={busy}
        canSave={Boolean(organization) && Boolean(name.trim())}
        submitText="Create team"
      >
        <Field>
          <FieldLabel htmlFor="team-name" className="sr-only">
            Team name
          </FieldLabel>
          <Input
            id="team-name"
            placeholder="Backend"
            autoComplete="off"
            value={name}
            onChange={(event) => setName(event.target.value)}
            className="max-w-md"
          />
        </Field>
      </SettingCard>

      <section className="flex flex-col gap-4">
        <h2 className="text-sm font-semibold">Teams</h2>
        {teams.length === 0 ? (
          <Card className="py-0">
            <Empty className="py-10">
              <EmptyHeader>
                <EmptyMedia variant="icon">
                  <UsersRound />
                </EmptyMedia>
                <EmptyTitle>No teams yet</EmptyTitle>
                <EmptyDescription>
                  Group members to share repositories with all of them at once.
                </EmptyDescription>
              </EmptyHeader>
            </Empty>
          </Card>
        ) : (
          teams.map((team) => (
            <Card key={team.id} className="gap-0 py-0">
              <Item className="border-b">
                <ItemMedia variant="icon">
                  <UsersRound />
                </ItemMedia>
                <ItemContent>
                  <ItemTitle>
                    <Link
                      href={`/${slug}/teams/${team.slug}`}
                      className="hover:underline"
                    >
                      {team.name}
                    </Link>
                  </ItemTitle>
                  <ItemDescription>
                    @{slug}/{team.slug} ·{" "}
                    {team.repositoryCount === 1
                      ? "1 repository"
                      : `${team.repositoryCount} repositories`}
                  </ItemDescription>
                </ItemContent>
                <ItemActions>
                  <Button
                    size="sm"
                    variant="ghost"
                    className="text-destructive"
                    disabled={busy || !organization}
                    onClick={() =>
                      change(
                        () =>
                          authClient.organization.removeTeam({
                            teamId: team.id,
                            organizationId: organization?.id,
                          }),
                        `Team ${team.name} deleted`,
                      ).then((ok) => {
                        if (ok) return refresh();
                      })
                    }
                  >
                    Delete team
                  </Button>
                </ItemActions>
              </Item>
              <TeamMembers organization={slug} team={team.slug} isAdmin />
            </Card>
          ))
        )}
      </section>
    </div>
  );
}
