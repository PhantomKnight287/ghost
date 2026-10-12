"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Spinner } from "@/components/ui/spinner";
import { apiClient, unwrap } from "@/lib/api/client";

/** The viewer's organizations that restrict OAuth apps, and whether this app reaches each; a member asks an organization's admins for an app it keeps out. Renders nothing when no organization restricts apps. */
export function OrganizationAccess({ clientId }: { clientId: string }) {
  const queryKey = ["oauth-apps", clientId, "organizations"];
  const queryClient = useQueryClient();
  const { data, isPending } = useQuery({
    queryKey,
    queryFn: () =>
      unwrap(
        apiClient.GET("/api/oauth-apps/{clientId}/organizations", {
          params: { path: { clientId } },
        }),
      ),
  });
  const ask = useMutation({
    mutationFn: (slug: string) =>
      unwrap(
        apiClient.POST(
          "/api/organizations/{slug}/oauth-app-access/{clientId}/request",
          { params: { path: { slug, clientId } } },
        ),
      ),
    onSuccess: () => {
      toast.success("Asked the organization's admins");
      return queryClient.invalidateQueries({ queryKey });
    },
    onError: (error) => toast.error(error.message),
  });

  if (isPending) return <OrganizationAccessSkeleton />;
  const restricting = (data?.organizations ?? []).filter(
    (organization) => organization.restricted,
  );
  if (restricting.length === 0) return null;

  return (
    <div className="flex flex-col gap-2">
      <h3 className="text-sm font-medium">Organization access</h3>
      <ul className="flex flex-col gap-2">
        {restricting.map((organization) => (
          <li
            key={organization.slug}
            className="flex items-center justify-between gap-3 text-sm"
          >
            <span className="min-w-0 truncate">{organization.name}</span>
            {organization.allowed ? (
              <Badge>Allowed</Badge>
            ) : organization.state === null ? (
              <Button
                size="sm"
                variant="outline"
                disabled={ask.isPending}
                onClick={() => ask.mutate(organization.slug)}
              >
                {ask.isPending && ask.variables === organization.slug && (
                  <Spinner />
                )}
                Request access
              </Button>
            ) : (
              <Badge variant="secondary">
                {organization.state === "denied" ? "Denied" : "Requested"}
              </Badge>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}

export function OrganizationAccessSkeleton() {
  return (
    <div className="flex flex-col gap-2">
      <Skeleton className="h-4 w-36" />
      <Skeleton className="h-8 w-full" />
    </div>
  );
}
