"use client";

import { useRouter } from "next/navigation";
import { useAction } from "next-safe-action/hooks";
import { useState } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { FieldError } from "@/components/ui/field";
import { Spinner } from "@/components/ui/spinner";

import { updateInstallation } from "./actions";
import { RepositorySelection, type Selection } from "./repository-selection";

/** Changes which of the account's repositories an installation reaches. */
export function ConfigureRepositories({
  installation,
  repositories,
}: {
  installation: {
    id: string;
    repositorySelection: Selection["repositorySelection"];
    repositories: { id: string }[];
  };
  repositories: { id: string; fullName: string }[];
}) {
  const router = useRouter();
  const [selection, setSelection] = useState<Selection>({
    repositorySelection: installation.repositorySelection,
    repositoryIds: installation.repositories.map(({ id }) => id),
  });
  const save = useAction(updateInstallation, {
    onSuccess: () => {
      toast.success("Repositories saved");
      router.refresh();
    },
  });

  return (
    <section>
      <h2 className="mb-3 text-sm font-semibold">Repository access</h2>
      <Card className="gap-4 px-6">
        <RepositorySelection
          repositories={repositories}
          value={selection}
          onChange={setSelection}
        />
        {save.result.serverError && (
          <FieldError>{save.result.serverError}</FieldError>
        )}
        <Button
          size="sm"
          className="self-start"
          disabled={
            save.isExecuting ||
            (selection.repositorySelection === "selected" &&
              selection.repositoryIds.length === 0)
          }
          onClick={() => save.execute({ id: installation.id, ...selection })}
        >
          {save.isExecuting && <Spinner />}
          Save
        </Button>
      </Card>
    </section>
  );
}
