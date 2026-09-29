"use client";

import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import { Suspense, useState } from "react";
import { CircleUser, Ghost, Plus, Search } from "lucide-react";

import { NotificationBell } from "@/components/notifications/notification-bell";
import { NewRepositoryDialog } from "@/components/repositories/new-repository-dialog";
import { SearchForm } from "@/components/search/search-form";
import { CustomThemeDialog, ThemeSubmenu } from "@/components/theme-picker";
import { UserButton } from "@/components/auth/user/user-button";
import { Button } from "@/components/ui/button";

const HEADER_SEARCH_CLASS = "hidden w-56 sm:block";

export function AppHeader({
  username,
  owners,
  repository,
}: {
  username: string;
  owners: string[];
  /** Set on a repository's pages, where the search bar searches that repository's code. */
  repository?: { owner: string; slug: string };
}) {
  const action = repository
    ? `/${repository.owner}/${repository.slug}/search`
    : "/search";
  const placeholder = repository ? "Search this repository" : "Search Ghost";
  const [customThemeOpen, setCustomThemeOpen] = useState(false);

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
          {/* reading the URL opts a prerendered page out of static rendering up to the nearest boundary, so the bar gets its own */}
          <Suspense
            fallback={
              <SearchForm
                action={action}
                placeholder={placeholder}
                className={HEADER_SEARCH_CLASS}
              />
            }
          >
            <CurrentSearchForm action={action} placeholder={placeholder} />
          </Suspense>

          {/* no room for the bar on a phone: the icon opens the search page, which has its own */}
          <Button asChild variant="ghost" size="icon" className="sm:hidden">
            <Link href={action} aria-label={placeholder}>
              <Search />
            </Link>
          </Button>

          <NewRepositoryDialog owners={owners} defaultOwner={username}>
            {/* square on a phone, where the label is hidden and the Button's inline-start padding (which outranks a plain override) would push the icon off centre */}
            <Button
              size="sm"
              aria-label="New repository"
              className="max-sm:w-7 max-sm:px-0!"
            >
              <Plus data-icon="inline-start" />
              <span className="hidden sm:inline">New</span>
            </Button>
          </NewRepositoryDialog>

          {username && <NotificationBell />}

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
              <ThemeSubmenu
                key="theme"
                onCustomize={() => setCustomThemeOpen(true)}
              />,
            ]}
          />
        </div>
      </div>

      <CustomThemeDialog
        open={customThemeOpen}
        onOpenChange={setCustomThemeOpen}
      />
    </header>
  );
}

/** On the results page the bar holds the search being shown, and resubmitting keeps the tab. Anywhere else a `q` means something else, like the profile's repository filter. */
function CurrentSearchForm({
  action,
  placeholder,
}: {
  action: string;
  placeholder: string;
}) {
  const pathname = usePathname();
  const params = useSearchParams();
  const onResults = pathname === action;

  return (
    <SearchForm
      action={action}
      placeholder={placeholder}
      query={onResults ? (params.get("q") ?? "") : ""}
      type={onResults ? params.get("type") : null}
      className={HEADER_SEARCH_CLASS}
    />
  );
}
