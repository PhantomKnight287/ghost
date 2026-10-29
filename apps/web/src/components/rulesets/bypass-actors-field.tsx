"use client";

import { Bot, Plus, Shield, Trash2, Users } from "lucide-react";

import { RoleSelect } from "@/components/role-select";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Field, FieldDescription, FieldLabel } from "@/components/ui/field";
import { roleLabels } from "@/lib/repository-role";
import { type BypassActor, bypassRoles } from "@/lib/rulesets";

const modes = ["always", "pull_request"] as const;
const modeLabels = { always: "Always", pull_request: "Pull requests only" };

/** Who may skip the ruleset: repository roles, the organization's teams and its admins, and apps installed on the repository, each always or only by merging a pull request. `teams` is null on a personal repository, which has neither teams nor organization admins. */
export function BypassActorsField({
  value,
  onChange,
  teams,
  apps,
}: {
  value: BypassActor[];
  onChange: (actors: BypassActor[]) => void;
  teams: { id: string; name: string }[] | null;
  apps: { appId: number; name: string }[];
}) {
  const nameOf = (actor: BypassActor) =>
    actor.actorType === "RepositoryRole"
      ? `${roleLabels[actor.role!]} role and above`
      : actor.actorType === "Team"
        ? (teams?.find(({ id }) => id === actor.teamId)?.name ?? "Team")
        : actor.actorType === "Integration"
          ? (apps.find(({ appId }) => appId === actor.appId)?.name ??
            `App ${actor.appId}, not installed here`)
          : "Organization admins";
  const keyOf = (actor: BypassActor) =>
    `${actor.actorType}-${actor.role ?? actor.teamId ?? actor.appId ?? ""}`;
  const has = (candidate: BypassActor) =>
    value.some((actor) => keyOf(actor) === keyOf(candidate));
  const candidates: BypassActor[] = [
    ...bypassRoles.map((role) => ({
      actorType: "RepositoryRole" as const,
      role,
      bypassMode: "always" as const,
    })),
    ...(teams ?? []).map(({ id }) => ({
      actorType: "Team" as const,
      teamId: id,
      bypassMode: "always" as const,
    })),
    ...(teams
      ? [
          {
            actorType: "OrganizationAdmin" as const,
            bypassMode: "always" as const,
          },
        ]
      : []),
    ...apps.map(({ appId }) => ({
      actorType: "Integration" as const,
      appId,
      bypassMode: "always" as const,
    })),
  ].filter((candidate) => !has(candidate));

  return (
    <Field>
      <FieldLabel>Bypass list</FieldLabel>
      <FieldDescription>
        Everyone else is held to the rules, the repository owner included.
      </FieldDescription>
      {value.length > 0 && (
        <ul className="divide-y rounded-lg border">
          {value.map((actor, index) => (
            <li
              key={keyOf(actor)}
              className="flex flex-wrap items-center gap-3 px-3 py-2 text-sm"
            >
              {actor.actorType === "Team" ? (
                <Users className="size-4 text-muted-foreground" />
              ) : actor.actorType === "Integration" ? (
                <Bot className="size-4 text-muted-foreground" />
              ) : (
                <Shield className="size-4 text-muted-foreground" />
              )}
              <span className="min-w-0 flex-1 truncate">{nameOf(actor)}</span>
              <RoleSelect
                roles={modes}
                labels={modeLabels}
                label={`When ${nameOf(actor)} may bypass`}
                value={actor.bypassMode}
                onChange={(bypassMode) =>
                  onChange(
                    value.map((other, at) =>
                      at === index ? { ...other, bypassMode } : other,
                    ),
                  )
                }
              />
              <Button
                type="button"
                size="icon"
                variant="ghost"
                aria-label={`Remove ${nameOf(actor)}`}
                onClick={() => onChange(value.filter((_, at) => at !== index))}
              >
                <Trash2 />
              </Button>
            </li>
          ))}
        </ul>
      )}
      <div>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={candidates.length === 0}
            >
              <Plus />
              Add bypass
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start">
            <DropdownMenuLabel>Roles</DropdownMenuLabel>
            {candidates
              .filter(({ actorType }) => actorType === "RepositoryRole")
              .map((candidate) => (
                <DropdownMenuItem
                  key={candidate.role}
                  onSelect={() => onChange([...value, candidate])}
                >
                  {nameOf(candidate)}
                </DropdownMenuItem>
              ))}
            {teams && (
              <>
                <DropdownMenuSeparator />
                <DropdownMenuLabel>Organization</DropdownMenuLabel>
                {candidates
                  .filter(
                    ({ actorType }) =>
                      actorType === "Team" || actorType === "OrganizationAdmin",
                  )
                  .map((candidate) => (
                    <DropdownMenuItem
                      key={keyOf(candidate)}
                      onSelect={() => onChange([...value, candidate])}
                    >
                      {nameOf(candidate)}
                    </DropdownMenuItem>
                  ))}
              </>
            )}
            {candidates.some(
              ({ actorType }) => actorType === "Integration",
            ) && (
              <>
                <DropdownMenuSeparator />
                <DropdownMenuLabel>Apps</DropdownMenuLabel>
                {candidates
                  .filter(({ actorType }) => actorType === "Integration")
                  .map((candidate) => (
                    <DropdownMenuItem
                      key={keyOf(candidate)}
                      onSelect={() => onChange([...value, candidate])}
                    >
                      {nameOf(candidate)}
                    </DropdownMenuItem>
                  ))}
              </>
            )}
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </Field>
  );
}
