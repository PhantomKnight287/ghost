"use client";

import Form from "next/form";
import Link from "next/link";
import { CircleUser, Ghost, Plus, Search } from "lucide-react";

import { NewRepositoryDialog } from "@/components/repositories/new-repository-dialog";
import { ThemePicker } from "@/components/theme-picker";
import { UserButton } from "@/components/auth/user/user-button";
import { Button } from "@/components/ui/button";
import {
  InputGroup,
  InputGroupAddon,
  InputGroupInput,
} from "@/components/ui/input-group";

export function AppHeader({
  username,
  owners,
  repository,
  query,
}: {
  username: string;
  owners: string[];
  /** Set on a repository's pages, where the search bar searches that repository's code. */
  repository?: { owner: string; slug: string };
  /** The search being shown, so the bar keeps it. */
  query?: string;
}) {
  const placeholder = repository ? "Search this repository" : "Search Ghost";

  return (
    <header className="sticky top-0 z-40 border-b bg-background/80 backdrop-blur">
      <div className="mx-auto flex h-14 w-full max-w-6xl items-center gap-3 px-4 md:px-6">
        <Link
          href="/dashboard"
          className="flex items-center gap-2 font-semibold tracking-tight"
        >
          <Ghost className="size-5" />
          Ghost
        </Link>

        <div className="ml-auto flex items-center gap-2">
          <Form
            action={
              repository
                ? `/${repository.owner}/${repository.slug}/search`
                : "/search"
            }
            className="hidden sm:block"
          >
            <InputGroup className="w-56">
              <InputGroupAddon>
                <Search />
              </InputGroupAddon>
              <InputGroupInput
                key={query}
                type="search"
                name="q"
                required
                defaultValue={query}
                placeholder={placeholder}
                aria-label={placeholder}
              />
            </InputGroup>
          </Form>

          <NewRepositoryDialog owners={owners} defaultOwner={username}>
            <Button size="sm">
              <Plus data-icon="inline-start" />
              New
            </Button>
          </NewRepositoryDialog>

          <ThemePicker />

          <UserButton
            size="icon"
            align="end"
            links={[
              {
                label: "Your profile",
                href: `/${username}`,
                icon: <CircleUser />,
                visibility: "authenticated",
              },
            ]}
          />
        </div>
      </div>
    </header>
  );
}
