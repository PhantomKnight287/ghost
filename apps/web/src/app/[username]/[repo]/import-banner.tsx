"use client";

import { atLeast } from "@ghost/permissions";
import { useMutation, useQuery } from "@tanstack/react-query";
import { useRouter } from "next/navigation";
import { useEffect } from "react";

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import { apiClient, apiErrorMessage } from "@/lib/api/client";
import type { components } from "@/lib/api/v1";
import type { ViewerRole } from "@/lib/repository-role";

type RepositoryImport = components["schemas"]["RepositoryImportDTO"];

const POLL_MS = 5000;

/** Shown while the GitHub import that created this repository is unfinished. Polls until it ends, then refreshes the page so the imported code and issues appear. */
export function ImportBanner({
  username,
  repo,
  viewerRole,
  initial,
}: {
  username: string;
  repo: string;
  viewerRole: ViewerRole | null;
  initial: RepositoryImport;
}) {
  const router = useRouter();
  const path = { params: { path: { username, repo } } };

  const { data = initial, refetch } = useQuery({
    queryKey: ["repository-import", username, repo],
    initialData: initial,
    queryFn: async () => {
      const { data, error } = await apiClient.GET(
        "/api/repositories/{username}/{repo}/import",
        path,
      );
      if (error) throw new Error(apiErrorMessage(error));
      return data;
    },
    refetchInterval: (query) =>
      query.state.data?.status === "failed" ? false : POLL_MS,
  });

  useEffect(() => {
    if (data.status === "succeeded") router.refresh();
  }, [data.status, router]);

  const retry = useMutation({
    mutationFn: async () => {
      const { error } = await apiClient.POST(
        "/api/repositories/{username}/{repo}/import/retry",
        path,
      );
      if (error) throw new Error(apiErrorMessage(error));
    },
    onSuccess: () => refetch(),
  });

  if (data.status === "succeeded") return null;

  if (data.status === "failed") {
    return (
      <Alert variant="destructive" className="mb-4">
        <AlertTitle>Importing {data.source} from GitHub failed</AlertTitle>
        <AlertDescription>
          <p>{data.lastError ?? "The import stopped without saying why."}</p>
          {retry.error && <p>{retry.error.message}</p>}
          {atLeast(viewerRole, "admin") && (
            <Button
              size="sm"
              variant="outline"
              className="mt-2"
              disabled={retry.isPending}
              onClick={() => retry.mutate()}
            >
              {retry.isPending && <Spinner />}
              Retry import
            </Button>
          )}
        </AlertDescription>
      </Alert>
    );
  }

  return (
    <Alert className="mb-4">
      <Spinner />
      <AlertTitle>Importing {data.source} from GitHub</AlertTitle>
      <AlertDescription>
        Code, releases, issues and pull requests appear as they arrive.
        {data.lastError &&
          ` The last attempt failed (${data.lastError}); retrying.`}
      </AlertDescription>
    </Alert>
  );
}
