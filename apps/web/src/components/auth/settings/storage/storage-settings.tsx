"use client";

import { useQuery } from "@tanstack/react-query";
import { Fragment } from "react";

import { Card, CardContent } from "@/components/ui/card";
import {
  Item,
  ItemContent,
  ItemDescription,
  ItemGroup,
  ItemSeparator,
  ItemTitle,
} from "@/components/ui/item";
import { Skeleton } from "@/components/ui/skeleton";
import { apiClient, apiErrorMessage } from "@/lib/api/client";
import { useAuthenticate } from "@/lib/auth/use-authenticate";
import { authClient } from "@/lib/auth-client";
import { cn, formatBytes } from "@/lib/utils";

type Limit = {
  title: string;
  usedBytes: number;
  quotaBytes: number | null;
  counts: string;
  over: string;
};

/** What an account stores against each of its quotas, what each one covers, and what is refused once it is full. */
export function StorageSettings(props: {
  /** An organization's slug; the signed-in user's own account when left out. */
  owner?: string;
}) {
  const { data: session } = useAuthenticate(authClient);
  const owner = props.owner ?? session?.user.username ?? "";

  const { data, error, isPending } = useQuery({
    queryKey: ["storage", owner],
    enabled: Boolean(owner),
    queryFn: async () => {
      const { data, error } = await apiClient.GET("/api/storage/{owner}", {
        params: { path: { owner } },
      });
      if (error) throw new Error(apiErrorMessage(error));
      return data;
    },
  });

  const limits: Limit[] = data
    ? [
        {
          title: "Repositories",
          usedBytes: data.usedBytes,
          quotaBytes: data.quotaBytes,
          counts:
            "Pushed git data and the heads of pull requests merged into the account's repositories. Git LFS objects, release assets, attachments and forks count separately.",
          over: "Pushes that add data are refused, and pull requests stop merging into the account's repositories. Pushes that only delete branches or tags still work.",
        },
        {
          title: "Git LFS",
          usedBytes: data.lfs.usedBytes,
          quotaBytes: data.lfs.quotaBytes,
          counts:
            "Git LFS objects uploaded to repositories that are not forks.",
          over: "New LFS uploads are refused, so a push carrying new LFS files fails. Objects already stored can still be downloaded.",
        },
        // A person also pays for the files they attach to issues and comments, wherever they post them; an organization never uploads any.
        props.owner
          ? {
              title: "Release assets",
              usedBytes: data.asset.usedBytes,
              quotaBytes: data.asset.quotaBytes,
              counts:
                "Files attached to releases in repositories that are not forks.",
              over: "New release asset uploads are refused. Releases themselves, and assets already uploaded, are unaffected.",
            }
          : {
              title: "Release assets and attachments",
              usedBytes: data.asset.usedBytes,
              quotaBytes: data.asset.quotaBytes,
              counts:
                "Files attached to releases in your repositories that are not forks, and files you attached to issues, pull requests and comments in any repository.",
              over: "New release asset uploads and attachments are refused. Releases, comments and files already uploaded are unaffected.",
            },
        {
          title: "Forks",
          usedBytes: data.fork.usedBytes,
          quotaBytes: data.fork.quotaBytes,
          counts:
            "Everything the account's forks hold, Git LFS objects and release assets included. A new fork counts the full size of the repository it copies.",
          over: "New forks are refused, as are pushes, LFS uploads and release asset uploads that add data to forks.",
        },
      ]
    : [];

  return (
    <div>
      <h2 className="mb-3 text-sm font-semibold">Storage</h2>

      <Card className="gap-0 p-0">
        <CardContent className="p-0">
          <ItemGroup className="gap-0!">
            {error ? (
              <Item>
                <ItemContent>
                  <ItemDescription>{error.message}</ItemDescription>
                </ItemContent>
              </Item>
            ) : isPending ? (
              <LimitSkeleton />
            ) : (
              <>
                {limits.map((limit, index) => (
                  <Fragment key={limit.title}>
                    {index > 0 && <ItemSeparator className="my-0!" />}
                    <LimitRow limit={limit} />
                  </Fragment>
                ))}
                <ItemSeparator className="my-0!" />
                <Item>
                  <ItemContent>
                    <div className="flex items-baseline justify-between gap-4">
                      <ItemTitle>Release asset size</ItemTitle>
                      <span className="text-sm tabular-nums">
                        {formatBytes(data.maxAssetBytes)} per file
                      </span>
                    </div>
                    <ItemDescription className="line-clamp-none">
                      The largest single file a release can carry. A bigger file
                      is refused, whatever room the account has left.
                    </ItemDescription>
                  </ItemContent>
                </Item>
              </>
            )}
          </ItemGroup>
        </CardContent>
      </Card>

      <p className="mt-2 text-xs text-muted-foreground">
        Usage includes uploads still in progress. Deleting repositories or
        release assets frees space, as does removing an attachment from every
        comment that shows it, a day later; deleting branches does not, since
        pushed data stays in the repository&apos;s history.
      </p>
    </div>
  );
}

function LimitRow({ limit }: { limit: Limit }) {
  const { usedBytes, quotaBytes } = limit;
  const percent =
    quotaBytes === null
      ? null
      : quotaBytes === 0
        ? 100
        : (usedBytes / quotaBytes) * 100;
  const full = percent !== null && percent >= 100;

  return (
    <Item>
      <ItemContent className="gap-2">
        <div className="flex items-baseline justify-between gap-4">
          <ItemTitle>{limit.title}</ItemTitle>
          <span
            className={cn("text-sm tabular-nums", full && "text-destructive")}
          >
            {formatBytes(usedBytes)}
            {quotaBytes === null
              ? " · Unlimited"
              : ` of ${formatBytes(quotaBytes)}`}
          </span>
        </div>

        {percent !== null && (
          <div
            role="progressbar"
            aria-label={`${limit.title} storage used`}
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={Math.min(100, Math.round(percent))}
            className="h-2 overflow-hidden rounded-full bg-muted"
          >
            <div
              className={cn(
                "h-full rounded-full bg-primary",
                percent >= 90 && "bg-amber-500",
                full && "bg-destructive",
              )}
              style={{ width: `${Math.min(100, percent)}%` }}
            />
          </div>
        )}

        <ItemDescription className="line-clamp-none">
          {limit.counts}
        </ItemDescription>
        {quotaBytes !== null && (
          <ItemDescription
            className={cn("line-clamp-none", full && "text-destructive")}
          >
            {full ? "Full: " : "When full: "}
            {limit.over}
          </ItemDescription>
        )}
      </ItemContent>
    </Item>
  );
}

function LimitSkeleton() {
  return (
    <Item>
      <ItemContent className="gap-2">
        <Skeleton className="h-4 w-40" />
        <Skeleton className="h-2 w-full" />
        <Skeleton className="h-3 w-56" />
      </ItemContent>
    </Item>
  );
}
