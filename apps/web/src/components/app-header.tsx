"use client";

import Link from "next/link";
import { CircleUser, Ghost, Plus, Search } from "lucide-react";

import { NewRepositoryDialog } from "@/components/repositories/new-repository-dialog";
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
}: {
  username: string;
  owners: string[];
}) {
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
          <InputGroup className="hidden w-56 sm:flex">
            <InputGroupAddon>
              <Search />
            </InputGroupAddon>
            <InputGroupInput
              type="search"
              placeholder="Search repositories"
              aria-label="Search repositories"
            />
          </InputGroup>

          <NewRepositoryDialog owners={owners} defaultOwner={username}>
            <Button size="sm">
              <Plus data-icon="inline-start" />
              New
            </Button>
          </NewRepositoryDialog>

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
