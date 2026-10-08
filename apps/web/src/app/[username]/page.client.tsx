"use client";

import { useRef, type ReactNode } from "react";
import { useDebouncer } from "@tanstack/react-pacer";
import Form from "next/form";
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
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyTitle,
} from "@/components/ui/empty";

type RepositoryEntity = components["schemas"]["RepositoryEntity"];

export function ProfileTabs({
  username,
  isViewer,
  owners,
  defaultTab,
  repositories,
  query,
  pagination,
  overview,
  extraTabs = [],
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
  /** After Repositories: a user's organizations, or an organization's people and teams. */
  extraTabs?: { value: string; label: string; content: ReactNode }[];
}) {
  const filter = useRef<HTMLFormElement>(null);
  const submitFilter = useDebouncer(() => filter.current?.requestSubmit(), {
    wait: 300,
  });

  return (
    <Tabs defaultValue={defaultTab}>
      <TabsList>
        <TabsTrigger value="overview">Overview</TabsTrigger>
        <TabsTrigger value="repositories">Repositories</TabsTrigger>
        {extraTabs.map(({ value, label }) => (
          <TabsTrigger key={value} value={value}>
            {label}
          </TabsTrigger>
        ))}
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
                onChange={() => submitFilter.maybeExecute()}
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
                repository={{ ...repository, owner: username }}
              />
            ))}
          </div>
        ) : (
          <Empty className="border border-dashed">
            <EmptyHeader>
              <EmptyTitle>
                {query ? "No matching repositories" : "No repositories yet"}
              </EmptyTitle>
              <EmptyDescription>
                {query
                  ? "Try a different search term."
                  : isViewer
                    ? "Create your first repository to start tracking a project."
                    : `${username} hasn't published any repositories.`}
              </EmptyDescription>
            </EmptyHeader>
          </Empty>
        )}

        {pagination}
      </TabsContent>

      {extraTabs.map(({ value, content }) => (
        <TabsContent key={value} value={value} className="pt-6">
          {content}
        </TabsContent>
      ))}
    </Tabs>
  );
}
