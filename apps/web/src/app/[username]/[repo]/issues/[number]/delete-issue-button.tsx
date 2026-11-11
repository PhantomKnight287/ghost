"use client";

import { Trash2 } from "lucide-react";
import { useAction } from "next-safe-action/hooks";

import { deleteIssue } from "@/components/issues/actions";
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

export function DeleteIssueButton({
  username,
  repo,
  number,
}: {
  username: string;
  repo: string;
  number: number;
}) {
  const { execute, isExecuting, result } = useAction(deleteIssue);

  return (
    <AlertDialog>
      <AlertDialogTrigger asChild>
        <Button
          variant="ghost"
          size="sm"
          className="justify-start px-0 text-muted-foreground hover:text-destructive"
        >
          <Trash2 data-icon="inline-start" />
          Delete issue
        </Button>
      </AlertDialogTrigger>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Delete issue #{number}?</AlertDialogTitle>
          <AlertDialogDescription>
            The issue, its comments and its history are deleted for good. This
            cannot be undone.
          </AlertDialogDescription>
        </AlertDialogHeader>
        {result.serverError && <FieldError>{result.serverError}</FieldError>}
        <AlertDialogFooter>
          <AlertDialogCancel>Cancel</AlertDialogCancel>
          <Button
            variant="destructive"
            disabled={isExecuting}
            onClick={() => execute({ username, repo, number })}
          >
            {isExecuting && <Spinner />}
            Delete issue
          </Button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
