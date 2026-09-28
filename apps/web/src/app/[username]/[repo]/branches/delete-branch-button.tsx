"use client";

import { Trash2 } from "lucide-react";
import { useAction } from "next-safe-action/hooks";

import { deleteBranch } from "@/components/repositories/actions";
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { FieldError } from "@/components/ui/field";
import { Spinner } from "@/components/ui/spinner";

export function DeleteBranchButton({
  username,
  repo,
  branch,
}: {
  username: string;
  repo: string;
  branch: string;
}) {
  const { execute, isExecuting, result } = useAction(deleteBranch);

  return (
    <AlertDialog>
      <AlertDialogTrigger asChild>
        <Button variant="outline" size="sm" aria-label={`Delete ${branch}`}>
          <Trash2 />
        </Button>
      </AlertDialogTrigger>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Delete {branch}?</AlertDialogTitle>
          <AlertDialogDescription>
            The branch is removed from the repository. Clones that already have
            it keep their copy.
          </AlertDialogDescription>
        </AlertDialogHeader>
        {result.serverError && <FieldError>{result.serverError}</FieldError>}
        <AlertDialogFooter>
          <AlertDialogCancel>Cancel</AlertDialogCancel>
          <Button
            variant="destructive"
            disabled={isExecuting}
            onClick={() => execute({ username, slug: repo, branch })}
          >
            {isExecuting && <Spinner />}
            Delete branch
          </Button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
