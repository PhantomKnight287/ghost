"use client";

import { Trash2 } from "lucide-react";
import { useAction } from "next-safe-action/hooks";

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

import { deleteRelease } from "./actions";

export function DeleteReleaseButton({
  username,
  repo,
  id,
  title,
}: {
  username: string;
  repo: string;
  id: string;
  title: string;
}) {
  const { execute, isExecuting, result } = useAction(deleteRelease);

  return (
    <AlertDialog>
      <AlertDialogTrigger asChild>
        <Button variant="outline" size="sm" aria-label={`Delete ${title}`}>
          <Trash2 />
        </Button>
      </AlertDialogTrigger>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Delete {title}?</AlertDialogTitle>
          <AlertDialogDescription>
            The release notes are deleted. The tag stays in the repository.
          </AlertDialogDescription>
        </AlertDialogHeader>
        {result.serverError && <FieldError>{result.serverError}</FieldError>}
        <AlertDialogFooter>
          <AlertDialogCancel>Cancel</AlertDialogCancel>
          <Button
            variant="destructive"
            disabled={isExecuting}
            onClick={() => execute({ username, repo, id })}
          >
            {isExecuting && <Spinner />}
            Delete release
          </Button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
