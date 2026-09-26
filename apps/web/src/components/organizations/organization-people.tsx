"use client";

import { Fragment, useState } from "react";

import { FromNowHoverCard } from "@/components/from-now-card";
import { SettingCard } from "@/components/repositories/setting-card";
import { RoleSelect } from "@/components/role-select";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Field, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
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
import {
  type OrganizationRole,
  organizationRoleHierarchy,
  organizationRoleOf,
} from "@ghost/permissions";
import { Skeleton } from "@/components/ui/skeleton";
import { apiClient } from "@/lib/api/client";
import { authClient } from "@/lib/auth-client";
import { organizationRoleLabels } from "@/lib/organization-role";

import { useOrganization } from "./use-organization";

export function OrganizationPeople({
  slug,
  isOwner,
}: {
  slug: string;
  /** Only an owner may make someone else an owner. */
  isOwner: boolean;
}) {
  const { organization, isPending, change, busy } = useOrganization(slug);
  const [invitee, setInvitee] = useState("");
  const [role, setRole] = useState<OrganizationRole>("member");
  const roles: readonly OrganizationRole[] = isOwner
    ? organizationRoleHierarchy
    : organizationRoleHierarchy.filter((candidate) => candidate !== "owner");
  const organizationId = organization?.id ?? "";
  const invitations =
    organization?.invitations.filter(
      (invitation) => invitation.status === "pending",
    ) ?? [];

  return (
    <div className="flex flex-col gap-8">
      <SettingCard
        title="Invite a member"
        hint="They join once they accept, from their dashboard or the email."
        onSubmit={() =>
          change(
            // An address goes to Better Auth as is; a username is resolved by the API, which keeps the account's email to itself.
            () =>
              invitee.includes("@")
                ? authClient.organization.inviteMember({
                    organizationId,
                    email: invitee.trim(),
                    role,
                  })
                : apiClient.POST("/api/organizations/{slug}/invitations", {
                    params: { path: { slug } },
                    body: { username: invitee.trim(), role },
                  }),
            `Invitation sent to ${invitee.trim()}`,
          ).then((ok) => ok && setInvitee(""))
        }
        pending={busy}
        canSave={Boolean(organization) && Boolean(invitee.trim())}
        submitText="Send invitation"
      >
        <div className="flex flex-col gap-4 sm:flex-row">
          <Field className="sm:flex-1">
            <FieldLabel htmlFor="invite-email">Username or email</FieldLabel>
            <Input
              id="invite-email"
              autoComplete="off"
              placeholder="octocat or teammate@example.com"
              value={invitee}
              onChange={(event) => setInvitee(event.target.value)}
            />
          </Field>
          <Field className="sm:w-40">
            <FieldLabel htmlFor="invite-member-role">Role</FieldLabel>
            <RoleSelect
              id="invite-member-role"
              labels={organizationRoleLabels}
              roles={roles}
              value={role}
              onChange={setRole}
            />
          </Field>
        </div>
      </SettingCard>

      <section>
        <h2 className="mb-3 text-sm font-semibold">
          Members
          {organization && (
            <span className="ml-2 font-normal text-muted-foreground tabular-nums">
              {organization.members.length}
            </span>
          )}
        </h2>
        <Card className="py-0">
          {isPending ? (
            <Skeleton className="m-4 h-10" />
          ) : (
            <ItemGroup className="gap-0!">
              {organization?.members.map((member, index) => {
                const current = organizationRoleOf(member.role) ?? "member";
                return (
                  <Fragment key={member.id}>
                    {index > 0 && <ItemSeparator className="my-0!" />}
                    <Item className="flex-wrap">
                      <ItemMedia>
                        <Avatar className="size-9">
                          <AvatarImage
                            src={member.user.image ?? undefined}
                            alt=""
                          />
                          <AvatarFallback>
                            {member.user.name.slice(0, 2).toUpperCase()}
                          </AvatarFallback>
                        </Avatar>
                      </ItemMedia>
                      <ItemContent className="min-w-0">
                        <ItemTitle>{member.user.name}</ItemTitle>
                        <ItemDescription className="truncate">
                          {member.user.email}
                        </ItemDescription>
                      </ItemContent>
                      <ItemActions>
                        <RoleSelect
                          labels={organizationRoleLabels}
                          roles={
                            roles.includes(current)
                              ? roles
                              : [...roles, current]
                          }
                          value={current}
                          disabled={busy || (current === "owner" && !isOwner)}
                          label={`Role for ${member.user.name}`}
                          onChange={(next) =>
                            change(
                              () =>
                                authClient.organization.updateMemberRole({
                                  organizationId,
                                  memberId: member.id,
                                  role: next,
                                }),
                              `${member.user.name} is now ${next}`,
                            )
                          }
                        />
                        <Button
                          size="sm"
                          variant="ghost"
                          disabled={busy || (current === "owner" && !isOwner)}
                          onClick={() =>
                            change(
                              () =>
                                authClient.organization.removeMember({
                                  organizationId,
                                  memberIdOrEmail: member.id,
                                }),
                              `${member.user.name} removed`,
                            )
                          }
                        >
                          Remove
                        </Button>
                      </ItemActions>
                    </Item>
                  </Fragment>
                );
              })}
            </ItemGroup>
          )}
        </Card>
      </section>

      {invitations.length > 0 && (
        <section>
          <h2 className="mb-3 text-sm font-semibold">Pending invitations</h2>
          <Card className="py-0">
            <ItemGroup className="gap-0!">
              {invitations.map((invitation, index) => (
                <Fragment key={invitation.id}>
                  {index > 0 && <ItemSeparator className="my-0!" />}
                  <Item>
                    <ItemContent>
                      <ItemTitle>{invitation.email}</ItemTitle>
                      <ItemDescription>
                        {
                          organizationRoleLabels[
                            organizationRoleOf(invitation.role) ?? "member"
                          ]
                        }{" "}
                        · expires{" "}
                        <FromNowHoverCard date={invitation.expiresAt} />
                      </ItemDescription>
                    </ItemContent>
                    <ItemActions>
                      <Button
                        size="sm"
                        variant="ghost"
                        disabled={busy}
                        onClick={() =>
                          change(
                            () =>
                              authClient.organization.cancelInvitation({
                                invitationId: invitation.id,
                              }),
                            "Invitation cancelled",
                          )
                        }
                      >
                        Cancel
                      </Button>
                    </ItemActions>
                  </Item>
                </Fragment>
              ))}
            </ItemGroup>
          </Card>
        </section>
      )}
    </div>
  );
}
