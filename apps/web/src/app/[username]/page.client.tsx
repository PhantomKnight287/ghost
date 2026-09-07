"use client";

import { useMemo, useState } from "react";
import { formatDistanceToNow } from "date-fns";
import { Plus, Search } from "lucide-react";
import { toast } from "sonner";

import { NewRepositoryDialog } from "@/components/repositories/new-repository-dialog";
import { RepositoryCard } from "@/components/repository-card";
import { Button } from "@/components/ui/button";
import {
  InputGroup,
  InputGroupAddon,
  InputGroupInput,
} from "@/components/ui/input-group";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { fetchClient } from "@/lib/fetch-client";

import type { components } from "@/lib/api/v1";
import { REPOSITORIES_PAGE_SIZE } from "./constants";

export type RepositoryEntity = components["schemas"]["RepositoryEntity"];

export function ProfileTabs({
  username,
  isViewer,
  owners,
  initialRepositories,
  initialCursor,
}: {
  username: string;
  isViewer: boolean;
  owners: string[];
  initialRepositories: RepositoryEntity[];
  initialCursor: string | null;
}) {
  const [repositories, setRepositories] = useState(initialRepositories);
  const [cursor, setCursor] = useState(initialCursor);
  const [isLoadingMore, setIsLoadingMore] = useState(false);
  const [filter, setFilter] = useState("");

  const visibleRepositories = useMemo(() => {
    const needle = filter.trim().toLowerCase();
    if (!needle) return repositories;

    return repositories.filter(
      (repository) =>
        repository.name.toLowerCase().includes(needle) ||
        repository.description?.toLowerCase().includes(needle),
    );
  }, [filter, repositories]);

  return (
    <Tabs defaultValue="repositories">
      <TabsList>
        <TabsTrigger value="overview">Overview</TabsTrigger>
        <TabsTrigger value="repositories">Repositories</TabsTrigger>
        <TabsTrigger value="organizations">Organizations</TabsTrigger>
      </TabsList>

      <TabsContent value="overview" className="pt-6">
        <p className="text-sm text-muted-foreground">
          {username} hasn&apos;t written a profile README yet.
        </p>
      </TabsContent>

      <TabsContent value="repositories" className="flex flex-col gap-4 pt-6">
        <div className="flex flex-wrap items-center gap-2">
          <InputGroup className="flex-1">
            <InputGroupAddon>
              <Search />
            </InputGroupAddon>
            <InputGroupInput
              type="search"
              placeholder="Find a repository"
              aria-label="Find a repository"
              value={filter}
              onChange={(event) => setFilter(event.target.value)}
            />
          </InputGroup>

          {isViewer && (
            <NewRepositoryDialog owners={owners} defaultOwner={username}>
              <Button>
                <Plus data-icon="inline-start" />
                New repository
              </Button>
            </NewRepositoryDialog>
          )}
        </div>

        {visibleRepositories.length > 0 ? (
          <div className="flex flex-col border-t">
            {visibleRepositories.map((repository) => (
              <RepositoryCard
                key={repository.id}
                repository={{
                  name: repository.name,
                  slug: repository.slug,
                  owner: username,
                  description: repository.description,
                  visibility: repository.visibility,
                  updatedAt: formatDistanceToNow(
                    new Date(repository.lastPushedAt),
                    { addSuffix: true },
                  ),
                }}
              />
            ))}
          </div>
        ) : (
          <div className="flex flex-col items-center gap-3 rounded-lg border border-dashed py-16 text-center">
            <p className="text-sm font-medium">
              {filter ? "No matching repositories" : "No repositories yet"}
            </p>
            <p className="max-w-xs text-sm text-muted-foreground">
              {filter
                ? "Try a different search term."
                : isViewer
                  ? "Create your first repository to start tracking a project."
                  : `${username} hasn't published any repositories.`}
            </p>
          </div>
        )}

        {cursor && (
          <Button
            variant="outline"
            className="self-center"
            onClick={() => {}}
            disabled={isLoadingMore}
          >
            {isLoadingMore ? "Loading..." : "Load more"}
          </Button>
        )}
      </TabsContent>

      <TabsContent value="organizations" className="pt-6">
        <p className="text-sm text-muted-foreground">
          {username} isn&apos;t a member of any organizations.
        </p>
      </TabsContent>
    </Tabs>
  );
}
