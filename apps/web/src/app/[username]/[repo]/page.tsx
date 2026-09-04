"use client";

import { use } from "react";
import Link from "next/link";
import { BookMarked, Copy, GitFork, Star } from "lucide-react";

import { AppHeader } from "@/components/app-header";
import { useAuthenticate } from "@better-auth-ui/react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  InputGroup,
  InputGroupAddon,
  InputGroupButton,
  InputGroupInput,
} from "@/components/ui/input-group";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { authClient } from "@/lib/auth-client";
import { API_URL } from "@/lib/env";

export default function RepositoryPage({
  params,
}: PageProps<"/[username]/[repo]">) {
  const { username, repo } = use(params);
  const { data } = useAuthenticate(authClient);
  const viewer = data?.user.username ?? "";
  const cloneUrl = `${API_URL}/${username}/${repo}.git`;

  return (
    <div className="flex min-h-full flex-col">
      <AppHeader username={viewer} owners={viewer ? [viewer] : []} />

      <main className="mx-auto flex w-full max-w-6xl flex-1 flex-col gap-6 px-4 py-8 md:px-6">
        <div className="flex flex-wrap items-center gap-3">
          <BookMarked className="size-5 text-muted-foreground" />

          <h1 className="flex items-center gap-1 text-xl">
            <Link
              href={`/${username}`}
              className="text-primary hover:underline"
            >
              {username}
            </Link>
            <span className="text-muted-foreground">/</span>
            <span className="font-semibold">{repo}</span>
          </h1>

          <Badge variant="outline" className="rounded-full">
            Public
          </Badge>

          <div className="ml-auto flex gap-2">
            <Button variant="outline" size="sm">
              <Star data-icon="inline-start" />
              Star
            </Button>
            <Button variant="outline" size="sm">
              <GitFork data-icon="inline-start" />
              Fork
            </Button>
          </div>
        </div>

        <Tabs defaultValue="code">
          <TabsList>
            <TabsTrigger value="code">Code</TabsTrigger>
            <TabsTrigger value="issues">Issues</TabsTrigger>
            <TabsTrigger value="settings">Settings</TabsTrigger>
          </TabsList>

          <TabsContent value="code" className="flex flex-col gap-6 pt-6">
            <div className="flex flex-col gap-2">
              <h2 className="text-sm font-semibold">
                Push an existing repository
              </h2>
              <InputGroup>
                <InputGroupInput readOnly value={cloneUrl} aria-label="Clone URL" />
                <InputGroupAddon align="inline-end">
                  <InputGroupButton size="icon-xs" aria-label="Copy clone URL">
                    <Copy />
                  </InputGroupButton>
                </InputGroupAddon>
              </InputGroup>
            </div>

            <div className="flex flex-col items-center gap-3 rounded-lg border border-dashed py-16 text-center">
              <p className="text-sm font-medium">This repository is empty</p>
              <p className="max-w-sm text-sm text-muted-foreground">
                Push a commit to see its files here.
              </p>
            </div>
          </TabsContent>

          <TabsContent value="issues" className="pt-6">
            <p className="text-sm text-muted-foreground">
              There aren&apos;t any issues yet.
            </p>
          </TabsContent>

          <TabsContent value="settings" className="pt-6">
            <p className="text-sm text-muted-foreground">
              Repository settings will live here.
            </p>
          </TabsContent>
        </Tabs>
      </main>
    </div>
  );
}
