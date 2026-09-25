"use client";

import { useRef, type ReactNode } from "react";
import Form from "next/form";
import { formatDistanceToNow } from "date-fns";
import { Plus, Search } from "lucide-react";

import { NewRepositoryDialog } from "@/components/repositories/new-repository-dialog";
import { RepositoryCard } from "@/components/repository-card";
import { Button } from "@/components/ui/button";
import {
  InputGroup,
  InputGroupAddon,
  InputGroupInput,
} from "@/components/ui/input-group";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";

import type { components } from "@/lib/api/v1";

export type RepositoryEntity = components["schemas"]["RepositoryEntity"];

const FILTER_DEBOUNCE_MS = 300;

export function ProfileTabs({
  username,
  isViewer,
  owners,
  defaultTab,
  repositories,
  query,
  pagination,
  overview,
}: {
  username: string;
  isViewer: boolean;
  owners: string[];
  defaultTab: "overview" | "repositories";
  repositories: RepositoryEntity[];
  query: string;
  /** Rendered on the server from the page's cursor. */
  pagination: ReactNode;
  /** Rendered on the server: the profile README, or its empty state. */
  overview: ReactNode;
}) {
  const filter = useRef<HTMLFormElement>(null);
  const pending = useRef<ReturnType<typeof setTimeout>>(undefined);

  return (
    <Tabs defaultValue={defaultTab}>
      <TabsList>
        <TabsTrigger value="overview">Overview</TabsTrigger>
        <TabsTrigger value="repositories">Repositories</TabsTrigger>
        <TabsTrigger value="organizations">Organizations</TabsTrigger>
      </TabsList>

      <TabsContent value="overview" className="flex flex-col gap-6 pt-6">
        {overview}
      </TabsContent>

      <TabsContent value="repositories" className="flex flex-col gap-4 pt-6">
        <div className="flex flex-wrap items-center gap-2">
          {/* Submitting drops the cursor, so a new filter always starts from the first page. */}
          <Form
            ref={filter}
            action={`/${username}`}
            replace
            scroll={false}
            className="flex-1"
          >
            <input type="hidden" name="tab" value="repositories" />
            <InputGroup>
              <InputGroupAddon>
                <Search />
              </InputGroupAddon>
              <InputGroupInput
                type="search"
                name="q"
                placeholder="Find a repository"
                aria-label="Find a repository"
                defaultValue={query}
                onChange={() => {
                  clearTimeout(pending.current);
                  pending.current = setTimeout(
                    () => filter.current?.requestSubmit(),
                    FILTER_DEBOUNCE_MS,
                  );
                }}
              />
            </InputGroup>
          </Form>

          {isViewer && (
            <NewRepositoryDialog owners={owners} defaultOwner={username}>
              <Button>
                <Plus data-icon="inline-start" />
                New repository
              </Button>
            </NewRepositoryDialog>
          )}
        </div>

        {repositories.length > 0 ? (
          <div className="flex flex-col border-t">
            {repositories.map((repository) => (
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
              {query ? "No matching repositories" : "No repositories yet"}
            </p>
            <p className="max-w-xs text-sm text-muted-foreground">
              {query
                ? "Try a different search term."
                : isViewer
                  ? "Create your first repository to start tracking a project."
                  : `${username} hasn't published any repositories.`}
            </p>
          </div>
        )}

        {pagination}
      </TabsContent>

      <TabsContent value="organizations" className="pt-6">
        <p className="text-sm text-muted-foreground">
          {username} isn&apos;t a member of any organizations.
        </p>
      </TabsContent>
    </Tabs>
  );
}
