"use client";

import { useDebouncedValue } from "@tanstack/react-pacer";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import Link from "next/link";
import { useState } from "react";
import {
  BookLock,
  BookMarked,
  GitBranch,
  Plus,
  Search,
  Users,
} from "lucide-react";

import { AppHeader } from "@/components/app-header";
import { CreateOrganizationDialog } from "@/components/auth/organization/create-organization-dialog";
import { Invitations } from "@/components/repositories/invitations";
import { NewRepositoryDialog } from "@/components/repositories/new-repository-dialog";
import type { Repository } from "@/components/repository-card";
import { FromNowHoverCard } from "@/components/from-now-card";
import { useAuthenticate } from "@/lib/auth/use-authenticate";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  InputGroup,
  InputGroupAddon,
  InputGroupInput,
} from "@/components/ui/input-group";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Separator } from "@/components/ui/separator";
import { apiClient, apiErrorMessage } from "@/lib/api/client";
import { authClient } from "@/lib/auth-client";
import { cn } from "@/lib/utils";

const ALL = "all";

export default function DashboardPage() {
  const { data } = useAuthenticate(authClient);
  const username = data?.user.username ?? "";
  const owners = username ? [username] : [];
  const [q, setQ] = useState("");
  const [creatingOrganization, setCreatingOrganization] = useState(false);
  // One request once typing pauses, not one per keystroke.
  const [search] = useDebouncedValue(q.trim(), { wait: 300 });
  // Whose repositories the sidebar shows: everything, or one account's, the way GitHub's context switcher narrows the dashboard.
  const [context, setContext] = useState(ALL);

  const { data: organizations = [] } = useQuery({
    queryKey: ["my-organizations", "all"],
    enabled: Boolean(username),
    queryFn: async () => {
      const { data, error } = await apiClient.GET("/api/organizations");
      if (error) throw new Error(apiErrorMessage(error));
      return data.organizations;
    },
  });

  // Owned and shared alike, most recently pushed first.
  const { data: repositories = [], isPending } = useQuery({
    queryKey: ["viewer-repositories", search, context],
    enabled: Boolean(username),
    placeholderData: keepPreviousData,
    queryFn: async (): Promise<Repository[]> => {
      const scoped = [context === ALL ? "" : `org:${context}`, search]
        .filter(Boolean)
        .join(" ");
      const { data, error } = await apiClient.GET("/api/repositories", {
        params: { query: { q: scoped || undefined, limit: 50 } },
      });
      if (error) throw new Error(apiErrorMessage(error));
      return data.repositories.map((repository) => ({
        name: repository.name,
        slug: repository.slug,
        owner: repository.owner,
        description: repository.description ?? undefined,
        visibility: repository.visibility,
        updatedAt: repository.lastPushedAt,
      }));
    },
  });

  return (
    <div className="flex min-h-full flex-col">
      <AppHeader username={username} owners={owners} />

      <main className="mx-auto grid w-full max-w-6xl flex-1 gap-8 px-4 py-8 md:px-6 lg:grid-cols-[300px_1fr]">
        <aside className="flex flex-col gap-4">
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-semibold">Repositories</h2>
            <NewRepositoryDialog owners={owners} defaultOwner={username}>
              <Button size="sm" variant="outline">
                <Plus data-icon="inline-start" />
                New
              </Button>
            </NewRepositoryDialog>
          </div>

          {organizations.length > 0 && (
            <Select value={context} onValueChange={setContext}>
              <SelectTrigger aria-label="Whose repositories" className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={ALL}>All repositories</SelectItem>
                <SelectItem value={username}>{username}</SelectItem>
                {organizations.map((organization) => (
                  <SelectItem key={organization.slug} value={organization.slug}>
                    {organization.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}

          <InputGroup>
            <InputGroupAddon>
              <Search />
            </InputGroupAddon>
            <InputGroupInput
              type="search"
              placeholder="Find a repository"
              aria-label="Find a repository"
              value={q}
              onChange={(event) => setQ(event.target.value)}
            />
          </InputGroup>

          {repositories.length > 0 ? (
            <ul className="-mx-2 flex flex-col">
              {repositories.map((repository) => (
                <li key={`${repository.owner}/${repository.slug}`}>
                  <RepositoryRow repository={repository} />
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-sm text-muted-foreground">
              {isPending
                ? "Loading repositories…"
                : search
                  ? "No repositories match."
                  : "You don't have any repositories yet."}
            </p>
          )}

          <Separator />

          <Link
            href={`/${username}`}
            className="text-sm text-primary hover:underline"
          >
            View your profile
          </Link>
        </aside>

        <section className="flex flex-col gap-6">
          <div className="flex flex-col gap-1">
            <h1 className="text-2xl font-semibold tracking-tight">
              {username ? `Welcome back, ${username}` : "Welcome back"}
            </h1>
            <p className="text-muted-foreground">
              Push your first commit or start a new project.
            </p>
          </div>

          <Invitations />

          <div className="grid gap-4 sm:grid-cols-3">
            <NewRepositoryDialog owners={owners} defaultOwner={username}>
              <StartCard
                icon={<BookMarked className="size-5" />}
                title="Create a repository"
                description="Host code, track changes, and collaborate."
              />
            </NewRepositoryDialog>
            <StartCard
              icon={<GitBranch className="size-5" />}
              title="Import a repository"
              description="Bring an existing project over with its history."
            />
            <StartCard
              icon={<Users className="size-5" />}
              title="Start an organization"
              description="Share repositories across a team."
              onClick={() => setCreatingOrganization(true)}
            />
            <CreateOrganizationDialog
              open={creatingOrganization}
              onOpenChange={setCreatingOrganization}
            />
          </div>

          <Card>
            <CardHeader>
              <CardTitle className="text-base">Recent activity</CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-sm text-muted-foreground">
                Activity from repositories you own or watch will show up here.
              </p>
            </CardContent>
          </Card>
        </section>
      </main>
    </div>
  );
}

/** Clickable when it opens something: as a dialog trigger, the dialog passes its click handler in through `props`. */
function StartCard({
  icon,
  title,
  description,
  ...props
}: {
  icon: React.ReactNode;
  title: string;
  description: string;
} & React.ComponentProps<typeof Card>) {
  const interactive = Boolean(props.onClick);
  return (
    <Card
      {...props}
      role={interactive ? "button" : undefined}
      tabIndex={interactive ? 0 : undefined}
      onKeyDown={(event) => {
        if (interactive && (event.key === "Enter" || event.key === " ")) {
          event.preventDefault();
          event.currentTarget.click();
        }
      }}
      className={cn(
        "gap-3",
        interactive && "cursor-pointer transition-colors hover:bg-muted/50",
      )}
    >
      <CardHeader>
        <span className="text-muted-foreground">{icon}</span>
        <CardTitle className="text-sm">{title}</CardTitle>
      </CardHeader>
      <CardContent>
        <p className="text-sm text-muted-foreground">{description}</p>
      </CardContent>
    </Card>
  );
}

/** One line per repository: the sidebar is too narrow for a card. */
function RepositoryRow({ repository }: { repository: Repository }) {
  const fullName = `${repository.owner}/${repository.name}`;
  const Icon = repository.visibility === "private" ? BookLock : BookMarked;

  return (
    <Link
      href={`/${repository.owner}/${repository.slug}`}
      title={fullName}
      className="flex items-center gap-2 rounded-md px-2 py-1.5 text-sm hover:bg-muted"
    >
      <Icon
        className="size-4 shrink-0 text-muted-foreground"
        aria-label={repository.visibility}
      />
      <span className="min-w-0 flex-1 truncate">
        <span className="text-muted-foreground">{repository.owner}/</span>
        <span className="font-medium">{repository.name}</span>
      </span>
      <FromNowHoverCard
        date={repository.updatedAt}
        className="shrink-0 text-xs text-muted-foreground"
      />
    </Link>
  );
}
