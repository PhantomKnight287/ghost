"use client";

import { Users } from "lucide-react";
import { useRouter } from "next/navigation";
import { useAction } from "next-safe-action/hooks";
import { Fragment, type ReactNode, useState } from "react";
import { toast } from "sonner";

import { FromNowHoverCard } from "@/components/from-now-card";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty";
import { Field, FieldDescription, FieldLabel } from "@/components/ui/field";
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
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import type { components } from "@/lib/api/v1";
import {
  type CollaboratorRole,
  collaboratorRoles,
  roleDescriptions,
} from "@/lib/repository-role";

import { inviteCollaborator, removeCollaborator } from "./actions";
import { SettingCard } from "./setting-card";

type Collaborator = components["schemas"]["CollaboratorDTO"];

type RepositoryProps = {
  username: string;
  slug: string;
};

export function RepositoryCollaborators({
  username,
  slug,
  collaborators,
}: RepositoryProps & { collaborators: Collaborator[] }) {
  const router = useRouter();

  const change = useAction(inviteCollaborator, {
    onSuccess: () => router.refresh(),
    onError: ({ error }) =>
      toast.error(error.serverError ?? "Could not change this role."),
  });
  const remove = useAction(removeCollaborator, {
    onSuccess: () => router.refresh(),
    onError: ({ error }) =>
      toast.error(error.serverError ?? "Could not remove this collaborator."),
  });
  const setRole = (collaborator: string, role: CollaboratorRole) =>
    change.execute({ username, slug, collaborator, role });
  const removeUser = (collaborator: string) =>
    remove.execute({ username, slug, collaborator });

  const members = collaborators.filter((c) => c.status === "accepted");
  const invited = collaborators.filter((c) => c.status !== "accepted");
  const busy = change.isExecuting || remove.isExecuting;

  return (
    <div className="flex flex-col gap-8">
      <InviteCard username={username} slug={slug} />

      <section>
        <h2 className="mb-3 text-sm font-semibold">
          Collaborators
          <span className="ml-2 font-normal text-muted-foreground tabular-nums">
            {members.length}
          </span>
        </h2>
        <Card className="py-0">
          {members.length === 0 ? (
            <Empty className="py-10">
              <EmptyHeader>
                <EmptyMedia variant="icon">
                  <Users />
                </EmptyMedia>
                <EmptyTitle>No collaborators yet</EmptyTitle>
                <EmptyDescription>
                  People you invite show up here once they accept.
                </EmptyDescription>
              </EmptyHeader>
            </Empty>
          ) : (
            <ItemGroup className="gap-0!">
              {members.map((collaborator, index) => (
                <Fragment key={collaborator.username}>
                  {index > 0 && <ItemSeparator className="my-0!" />}
                  <PersonRow collaborator={collaborator}>
                    <RoleSelect
                      value={collaborator.role}
                      disabled={busy}
                      onChange={(role) => setRole(collaborator.username, role)}
                      label={`Role for ${collaborator.username}`}
                    />
                    <Button
                      size="sm"
                      variant="ghost"
                      disabled={busy}
                      onClick={() => removeUser(collaborator.username)}
                    >
                      Remove
                    </Button>
                  </PersonRow>
                </Fragment>
              ))}
            </ItemGroup>
          )}
        </Card>
      </section>

      {invited.length > 0 && (
        <section>
          <h2 className="mb-3 text-sm font-semibold">Pending invitations</h2>
          <Card className="py-0">
            <ItemGroup className="gap-0!">
              {invited.map((collaborator, index) => (
                <Fragment key={collaborator.username}>
                  {index > 0 && <ItemSeparator className="my-0!" />}
                  <PersonRow collaborator={collaborator}>
                    {collaborator.status === "expired" && (
                      <Button
                        size="sm"
                        variant="outline"
                        disabled={busy}
                        onClick={() =>
                          setRole(collaborator.username, collaborator.role)
                        }
                      >
                        Resend
                      </Button>
                    )}
                    <Button
                      size="sm"
                      variant="ghost"
                      disabled={busy}
                      onClick={() => removeUser(collaborator.username)}
                    >
                      Cancel
                    </Button>
                  </PersonRow>
                </Fragment>
              ))}
            </ItemGroup>
          </Card>
        </section>
      )}
    </div>
  );
}

function InviteCard({ username, slug }: RepositoryProps) {
  const router = useRouter();
  const [invitee, setInvitee] = useState("");
  const [role, setRole] = useState<CollaboratorRole>("write");

  const invite = useAction(inviteCollaborator, {
    onSuccess: ({ input }) => {
      toast.success(`Invitation sent to ${input.collaborator}`);
      setInvitee("");
      router.refresh();
    },
    onError: ({ error }) =>
      toast.error(error.serverError ?? "Could not invite this user."),
  });

  return (
    <SettingCard
      title="Invite a collaborator"
      hint="They get access once they accept. Invitations lapse after 7 days."
      onSubmit={() =>
        invite.execute({ username, slug, collaborator: invitee.trim(), role })
      }
      pending={invite.isExecuting}
      canSave={Boolean(invitee.trim())}
      submitText="Send invitation"
    >
      <div className="flex flex-col gap-4 sm:flex-row">
        <Field className="sm:flex-1">
          <FieldLabel htmlFor="invite-username">Username</FieldLabel>
          <Input
            id="invite-username"
            autoComplete="off"
            placeholder="octocat"
            value={invitee}
            onChange={(event) => setInvitee(event.target.value)}
          />
        </Field>
        <Field className="sm:w-40">
          <FieldLabel htmlFor="invite-role">Role</FieldLabel>
          <RoleSelect id="invite-role" value={role} onChange={setRole} />
        </Field>
      </div>
      <FieldDescription className="mt-3">
        <span className="font-medium capitalize text-foreground">{role}</span>
        {": "}
        {roleDescriptions[role]}
      </FieldDescription>
    </SettingCard>
  );
}

function PersonRow({
  collaborator,
  children,
}: {
  collaborator: Collaborator;
  children: ReactNode;
}) {
  return (
    <Item className="flex-wrap">
      <ItemMedia>
        <Avatar className="size-9">
          {collaborator.image && (
            <AvatarImage src={collaborator.image} alt="" />
          )}
          <AvatarFallback>
            {collaborator.username.slice(0, 2).toUpperCase()}
          </AvatarFallback>
        </Avatar>
      </ItemMedia>
      <ItemContent className="min-w-0">
        <ItemTitle>
          {collaborator.username}
          {collaborator.status !== "accepted" && (
            <Badge variant="outline" className="capitalize">
              {collaborator.role}
            </Badge>
          )}
          {collaborator.status === "expired" && (
            <Badge variant="outline" className="text-destructive">
              Expired
            </Badge>
          )}
        </ItemTitle>
        <ItemDescription className="truncate">
          {collaborator.status === "accepted" || !collaborator.expiresAt ? (
            collaborator.name
          ) : (
            <>
              Invited <FromNowHoverCard date={collaborator.invitedAt} /> ·{" "}
              {collaborator.status === "expired" ? "expired" : "expires"}{" "}
              <FromNowHoverCard date={collaborator.expiresAt} />
            </>
          )}
        </ItemDescription>
      </ItemContent>
      <ItemActions>{children}</ItemActions>
    </Item>
  );
}

function RoleSelect({
  id,
  value,
  onChange,
  label,
  disabled,
}: {
  id?: string;
  value: CollaboratorRole;
  onChange: (role: CollaboratorRole) => void;
  label?: string;
  disabled?: boolean;
}) {
  return (
    <Select
      value={value}
      disabled={disabled}
      onValueChange={(next) => onChange(next as CollaboratorRole)}
    >
      <SelectTrigger
        id={id}
        aria-label={label}
        className="w-full capitalize sm:w-32"
      >
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {collaboratorRoles.map((role) => (
          <SelectItem key={role} value={role} className="capitalize">
            {role}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
