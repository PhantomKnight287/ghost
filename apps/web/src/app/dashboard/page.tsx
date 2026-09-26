"use client";

import { keepPreviousData, useQuery } from "@tanstack/react-query";
import Link from "next/link";
import { useState } from "react";
import { BookMarked, GitBranch, Plus, Search, Users } from "lucide-react";

import { AppHeader } from "@/components/app-header";
import { Invitations } from "@/components/repositories/invitations";
import { NewRepositoryDialog } from "@/components/repositories/new-repository-dialog";
import { RepositoryCard, type Repository } from "@/components/repository-card";
import { useAuthenticate } from "@/lib/auth/use-authenticate";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  InputGroup,
  InputGroupAddon,
  InputGroupInput,
} from "@/components/ui/input-group";
import { Separator } from "@/components/ui/separator";
import { apiClient, apiErrorMessage } from "@/lib/api/client";
import { authClient } from "@/lib/auth-client";

export default function DashboardPage() {
  const { data } = useAuthenticate(authClient);
  const username = data?.user.username ?? "";
  const owners = username ? [username] : [];
  const [q, setQ] = useState("");

  // Owned and shared alike, most recently pushed first.
  const { data: repositories = [], isPending } = useQuery({
    queryKey: ["viewer-repositories", q],
    enabled: Boolean(username),
    placeholderData: keepPreviousData,
    queryFn: async (): Promise<Repository[]> => {
      const { data, error } = await apiClient.GET("/api/repositories", {
        params: { query: { q: q.trim() || undefined, limit: 50 } },
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
            <div className="flex flex-col">
              {repositories.map((repository) => (
                <RepositoryCard
                  key={`${repository.owner}/${repository.name}`}
                  repository={repository}
                  showOwner
                />
              ))}
            </div>
          ) : (
            <p className="text-sm text-muted-foreground">
              {isPending
                ? "Loading repositories…"
                : q.trim()
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
            <StartCard
              icon={<BookMarked className="size-5" />}
              title="Create a repository"
              description="Host code, track changes, and collaborate."
            />
            <StartCard
              icon={<GitBranch className="size-5" />}
              title="Import a repository"
              description="Bring an existing project over with its history."
            />
            <StartCard
              icon={<Users className="size-5" />}
              title="Start an organization"
              description="Share repositories across a team."
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

function StartCard({
  icon,
  title,
  description,
}: {
  icon: React.ReactNode;
  title: string;
  description: string;
}) {
  return (
    <Card className="gap-3">
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
