"use client";

import { UserMinus } from "lucide-react";
import { useRouter } from "next/navigation";
import { useAction } from "next-safe-action/hooks";
import { useState } from "react";
import { toast } from "sonner";

import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Spinner } from "@/components/ui/spinner";
import type { components } from "@/lib/api/v1";
import {
  type CollaboratorRole,
  collaboratorRoles,
} from "@/lib/repository-role";

import { inviteCollaborator, removeCollaborator } from "./actions";

type Collaborator = components["schemas"]["CollaboratorDTO"];

export function RepositoryCollaborators({
  username,
  slug,
  collaborators,
}: {
  username: string;
  slug: string;
  collaborators: Collaborator[];
}) {
  const router = useRouter();
  const [invitee, setInvitee] = useState("");
  const [role, setRole] = useState<CollaboratorRole>("write");

  const invite = useAction(inviteCollaborator, {
    onSuccess: () => {
      setInvitee("");
      router.refresh();
    },
    onError: ({ error }) =>
      toast.error(error.serverError ?? "Could not invite this user."),
  });
  const remove = useAction(removeCollaborator, {
    onSuccess: () => router.refresh(),
    onError: ({ error }) =>
      toast.error(error.serverError ?? "Could not remove this collaborator."),
  });

  return (
    <section className="flex flex-col gap-4">
      <div className="flex flex-col gap-1">
        <h2 className="text-lg font-semibold">Collaborators</h2>
        <p className="text-sm text-muted-foreground">
          Invited people get access once they accept. Invitations lapse after 7
          days.
        </p>
      </div>

      <form
        className="flex flex-col gap-2 sm:flex-row"
        onSubmit={(event) => {
          event.preventDefault();
          invite.execute({ username, slug, collaborator: invitee, role });
        }}
      >
        <Input
          aria-label="Username to invite"
          placeholder="Username"
          autoComplete="off"
          value={invitee}
          onChange={(event) => setInvitee(event.target.value)}
          className="sm:flex-1"
        />
        <RoleSelect
          value={role}
          onChange={setRole}
          label="Role for the invitee"
        />
        <Button type="submit" disabled={invite.isExecuting || !invitee.trim()}>
          {invite.isExecuting && <Spinner />}
          Invite
        </Button>
      </form>

      {collaborators.length === 0 ? (
        <p className="rounded-lg border border-dashed p-4 text-sm text-muted-foreground">
          Nobody else has access yet.
        </p>
      ) : (
        <ul className="divide-y rounded-lg border">
          {collaborators.map((collaborator) => (
            <li
              key={collaborator.username}
              className="flex flex-wrap items-center gap-3 px-4 py-3"
            >
              <Avatar className="size-8">
                {collaborator.image && (
                  <AvatarImage src={collaborator.image} alt="" />
                )}
                <AvatarFallback>
                  {collaborator.username.slice(0, 2).toUpperCase()}
                </AvatarFallback>
              </Avatar>
              <div className="flex min-w-0 flex-1 flex-col">
                <span className="flex items-center gap-2 text-sm font-medium">
                  {collaborator.username}
                  {collaborator.status === "pending" && (
                    <Badge variant="outline">Pending</Badge>
                  )}
                  {collaborator.status === "expired" && (
                    <Badge variant="outline" className="text-destructive">
                      Expired
                    </Badge>
                  )}
                </span>
                <span className="truncate text-xs text-muted-foreground">
                  {collaborator.name}
                </span>
              </div>
              {collaborator.status === "expired" && (
                <Button
                  variant="outline"
                  size="sm"
                  disabled={invite.isExecuting}
                  onClick={() =>
                    invite.execute({
                      username,
                      slug,
                      collaborator: collaborator.username,
                      role: collaborator.role,
                    })
                  }
                >
                  Resend
                </Button>
              )}
              <RoleSelect
                value={collaborator.role}
                onChange={(next) =>
                  invite.execute({
                    username,
                    slug,
                    collaborator: collaborator.username,
                    role: next,
                  })
                }
                label={`Role for ${collaborator.username}`}
              />
              <Button
                variant="ghost"
                size="icon"
                aria-label={`Remove ${collaborator.username}`}
                disabled={remove.isExecuting}
                onClick={() =>
                  remove.execute({
                    username,
                    slug,
                    collaborator: collaborator.username,
                  })
                }
              >
                <UserMinus />
              </Button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function RoleSelect({
  value,
  onChange,
  label,
}: {
  value: CollaboratorRole;
  onChange: (role: CollaboratorRole) => void;
  label: string;
}) {
  return (
    <Select
      value={value}
      onValueChange={(next) => onChange(next as CollaboratorRole)}
    >
      <SelectTrigger aria-label={label} className="w-full capitalize sm:w-32">
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
