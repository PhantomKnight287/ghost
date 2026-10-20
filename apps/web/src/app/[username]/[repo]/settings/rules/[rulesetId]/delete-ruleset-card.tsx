"use client";

import { Trash2 } from "lucide-react";
import { useAction } from "next-safe-action/hooks";

import { deleteRuleset } from "@/components/rulesets/actions";
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
import { Card } from "@/components/ui/card";
import { FieldError } from "@/components/ui/field";
import { Spinner } from "@/components/ui/spinner";

export function DeleteRulesetCard({
  username,
  repo,
  ruleset,
}: {
  username: string;
  repo: string;
  ruleset: { id: string; name: string };
}) {
  const remove = useAction(deleteRuleset);

  return (
    <section>
      <h2 className="mb-3 text-sm font-semibold">Delete</h2>
      <Card className="flex-row items-center justify-between gap-4 px-6">
        <p className="text-sm text-muted-foreground">
          The refs it targets lose its protection at once. To pause it instead,
          set enforcement to Disabled.
        </p>
        <AlertDialog>
          <AlertDialogTrigger asChild>
            <Button size="sm" variant="destructive">
              <Trash2 />
              Delete
            </Button>
          </AlertDialogTrigger>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Delete {ruleset.name}?</AlertDialogTitle>
              <AlertDialogDescription>
                This cannot be undone.
              </AlertDialogDescription>
            </AlertDialogHeader>
            {remove.result.serverError && (
              <FieldError>{remove.result.serverError}</FieldError>
            )}
            <AlertDialogFooter>
              <AlertDialogCancel>Cancel</AlertDialogCancel>
              <Button
                variant="destructive"
                disabled={remove.isExecuting}
                onClick={() =>
                  remove.execute({ username, repo, id: ruleset.id })
                }
              >
                {remove.isExecuting && <Spinner />}
                Delete ruleset
              </Button>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </Card>
    </section>
  );
}
