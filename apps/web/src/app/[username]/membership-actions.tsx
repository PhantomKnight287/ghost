"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import { apiClient, apiErrorMessage } from "@/lib/api/client";
import { authClient } from "@/lib/auth-client";

/** A member's own controls on the organization's page: show or hide their membership, and leave. The last owner cannot leave; the API says so. */
export function MembershipActions({
  slug,
  isPublic,
}: {
  slug: string;
  isPublic: boolean;
}) {
  const router = useRouter();
  const [pending, setPending] = useState<"visibility" | "leave" | null>(null);

  async function toggleVisibility() {
    setPending("visibility");
    const params = { params: { path: { slug } } };
    const { error } = isPublic
      ? await apiClient.DELETE(
          "/api/organizations/{slug}/public-members",
          params,
        )
      : await apiClient.PUT("/api/organizations/{slug}/public-members", params);
    setPending(null);
    if (error) return toast.error(apiErrorMessage(error));
    toast.success(
      isPublic ? "Your membership is private" : "Your membership is public",
    );
    router.refresh();
  }

  async function leave() {
    setPending("leave");
    const { data: organization } =
      await authClient.organization.getFullOrganization({
        query: { organizationSlug: slug },
      });
    const { error } = organization
      ? await authClient.organization.leave({ organizationId: organization.id })
      : { error: { message: "Organization not found" } };
    setPending(null);
    if (error) return toast.error(error.message ?? "Could not leave");
    toast.success(`You left ${slug}`);
    router.push("/dashboard");
  }

  return (
    <div className="flex flex-col gap-2">
      <p className="text-xs text-muted-foreground">
        {isPublic
          ? "Your membership is public."
          : "Your membership is private: only members see it."}
      </p>
      <div className="flex gap-2">
        <Button
          size="sm"
          variant="outline"
          className="flex-1"
          disabled={pending !== null}
          onClick={toggleVisibility}
        >
          {pending === "visibility" && <Spinner />}
          {isPublic ? "Make private" : "Make public"}
        </Button>
        <Button
          size="sm"
          variant="ghost"
          className="text-destructive"
          disabled={pending !== null}
          onClick={() => {
            if (
              window.confirm(
                `Leave ${slug}? You lose access to its repositories.`,
              )
            ) {
              void leave();
            }
          }}
        >
          {pending === "leave" && <Spinner />}
          Leave
        </Button>
      </div>
    </div>
  );
}
