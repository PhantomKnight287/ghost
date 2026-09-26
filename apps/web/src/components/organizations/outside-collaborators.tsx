"use client";

import { UserRound } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Fragment, useState } from "react";
import { toast } from "sonner";

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
import { apiClient, apiErrorMessage } from "@/lib/api/client";
import type { components } from "@/lib/api/v1";
import { roleLabels } from "@/lib/repository-role";

type Collaborator = components["schemas"]["OutsideCollaboratorDTO"];

/** People with access to the organization's repositories who are not its members, and a way to take them off all of them at once. */
export function OutsideCollaborators({
  slug,
  collaborators,
}: {
  slug: string;
  collaborators: Collaborator[];
}) {
  const router = useRouter();
  const [removing, setRemoving] = useState<string | null>(null);

  async function remove(username: string) {
    setRemoving(username);
    const { error } = await apiClient.DELETE(
      "/api/organizations/{slug}/outside-collaborators/{username}",
      { params: { path: { slug, username } } },
    );
    setRemoving(null);
    if (error) return toast.error(apiErrorMessage(error));
    toast.success(`${username} no longer has access to ${slug}'s repositories`);
    router.refresh();
  }

  return (
    <section>
      <h2 className="mb-3 text-sm font-semibold">
        Outside collaborators
        <span className="ml-2 font-normal text-muted-foreground tabular-nums">
          {collaborators.length}
        </span>
      </h2>
      <Card className="py-0">
        {collaborators.length === 0 ? (
          <Empty className="py-10">
            <EmptyHeader>
              <EmptyMedia variant="icon">
                <UserRound />
              </EmptyMedia>
              <EmptyTitle>Nobody from outside</EmptyTitle>
              <EmptyDescription>
                People invited to a repository without joining the organization
                show up here.
              </EmptyDescription>
            </EmptyHeader>
          </Empty>
        ) : (
          <ItemGroup className="gap-0!">
            {collaborators.map((collaborator, index) => (
              <Fragment key={collaborator.username}>
                {index > 0 && <ItemSeparator className="my-0!" />}
                <Item className="flex-wrap">
                  <ItemMedia>
                    <Avatar className="size-9">
                      <AvatarImage
                        src={collaborator.image ?? undefined}
                        alt=""
                      />
                      <AvatarFallback>
                        {collaborator.username.slice(0, 2).toUpperCase()}
                      </AvatarFallback>
                    </Avatar>
                  </ItemMedia>
                  <ItemContent className="min-w-0">
                    <ItemTitle>
                      <Link
                        href={`/${collaborator.username}`}
                        className="hover:underline"
                      >
                        {collaborator.username}
                      </Link>
                    </ItemTitle>
                    <ItemDescription className="flex flex-wrap gap-1">
                      {collaborator.repositories.map((repository) => (
                        <Badge
                          key={repository.slug}
                          variant="outline"
                          className="font-normal"
                        >
                          <Link href={`/${slug}/${repository.slug}`}>
                            {repository.slug}
                          </Link>
                          · {roleLabels[repository.role]}
                          {repository.pending && " · invited"}
                        </Badge>
                      ))}
                    </ItemDescription>
                  </ItemContent>
                  <ItemActions>
                    <Button
                      size="sm"
                      variant="ghost"
                      disabled={removing !== null}
                      onClick={() => remove(collaborator.username)}
                    >
                      Remove from all
                    </Button>
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
