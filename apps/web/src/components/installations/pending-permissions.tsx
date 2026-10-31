"use client";

import { useRouter } from "next/navigation";
import { useAction } from "next-safe-action/hooks";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Spinner } from "@/components/ui/spinner";
import type { components } from "@/lib/api/v1";

import { acceptPermissions } from "./actions";
import { PermissionSummary } from "./permission-summary";

/** The permissions and events an app asks for beyond what this installation accepted, and the button that accepts them. */
export function PendingPermissions({
  installation,
  pending,
}: {
  installation: components["schemas"]["InstallationDTO"];
  pending: components["schemas"]["PendingPermissionsDTO"];
}) {
  const router = useRouter();
  const accept = useAction(acceptPermissions, {
    onSuccess: () => {
      toast.success("New permissions accepted");
      router.refresh();
    },
    onError: ({ error }) =>
      toast.error(error.serverError ?? "Could not accept them"),
  });
  const newEvents = pending.events.filter(
    (event) => !installation.events.includes(event),
  );

  return (
    <section>
      <h2 className="mb-1 text-sm font-semibold">Review new permissions</h2>
      <p className="mb-3 text-sm text-muted-foreground">
        {installation.app.name} asks for more than it was installed with. It
        keeps its current permissions until you accept.
      </p>
      <Card className="gap-4 px-6">
        <PermissionSummary permissions={pending.permissions} />
        {newEvents.length > 0 && (
          <p className="text-sm">
            <span className="font-medium">New events</span>
            <span className="ml-2 font-mono text-muted-foreground">
              {newEvents.join(", ")}
            </span>
          </p>
        )}
        <div>
          <Button
            size="sm"
            disabled={accept.isExecuting}
            onClick={() => accept.execute({ id: installation.id })}
          >
            {accept.isExecuting && <Spinner />}
            Accept new permissions
          </Button>
        </div>
      </Card>
    </section>
  );
}
