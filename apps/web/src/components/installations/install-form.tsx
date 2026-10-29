"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useAction } from "next-safe-action/hooks";
import { useState } from "react";

import { Button } from "@/components/ui/button";
import { FieldError } from "@/components/ui/field";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Spinner } from "@/components/ui/spinner";

import { installApp } from "./actions";
import { installationsPath } from "./paths";
import { RepositorySelection, type Selection } from "./repository-selection";

export type InstallAccount = {
  login: string;
  organization: boolean;
  repositories: { id: string; fullName: string }[];
  /** Set when the app is already installed there. */
  installationId: string | null;
};

/** Picks where to install an app, and on which repositories. An account that already has it links to its settings instead. */
export function InstallForm({
  slug,
  accounts,
}: {
  slug: string;
  accounts: InstallAccount[];
}) {
  const router = useRouter();
  const [login, setLogin] = useState(accounts[0]!.login);
  const [selection, setSelection] = useState<Selection>({
    repositorySelection: "all",
    repositoryIds: [],
  });
  const account = accounts.find((candidate) => candidate.login === login)!;
  const install = useAction(installApp, {
    onSuccess: ({ data }) => {
      if (!data) return;
      // The setup URL is the app's own site; anything else is a page of ours.
      if (data.redirectUrl.startsWith(window.location.origin))
        router.push(data.redirectUrl.slice(window.location.origin.length));
      else window.location.assign(data.redirectUrl);
    },
  });

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-2">
        <Label>Install on</Label>
        <Select
          value={login}
          onValueChange={(value) => {
            setLogin(value);
            setSelection({ repositorySelection: "all", repositoryIds: [] });
          }}
        >
          <SelectTrigger className="w-64">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {accounts.map((candidate) => (
              <SelectItem key={candidate.login} value={candidate.login}>
                {candidate.login}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {account.installationId ? (
        <p className="text-sm text-muted-foreground">
          Already installed on {account.login}.{" "}
          <Link
            className="underline underline-offset-2"
            href={`${installationsPath(account.organization ? account.login : undefined)}/${account.installationId}`}
          >
            Configure it
          </Link>
        </p>
      ) : (
        <>
          <div className="flex flex-col gap-2">
            <Label>Repositories</Label>
            <RepositorySelection
              repositories={account.repositories}
              value={selection}
              onChange={setSelection}
            />
          </div>
          {install.result.serverError && (
            <FieldError>{install.result.serverError}</FieldError>
          )}
          <Button
            className="self-start"
            disabled={
              install.isExecuting ||
              (selection.repositorySelection === "selected" &&
                selection.repositoryIds.length === 0)
            }
            onClick={() =>
              install.execute({ slug, account: login, ...selection })
            }
          >
            {install.isExecuting && <Spinner />}
            Install
          </Button>
        </>
      )}
    </div>
  );
}
