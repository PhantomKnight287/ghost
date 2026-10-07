"use client";

import { useQuery } from "@tanstack/react-query";
import { LockIcon } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import {
  Field,
  FieldDescription,
  FieldError,
  FieldLabel,
} from "@/components/ui/field";
import {
  Combobox,
  ComboboxContent,
  ComboboxEmpty,
  ComboboxInput,
  ComboboxItem,
  ComboboxList,
} from "@/components/ui/combobox";
import { Spinner } from "@/components/ui/spinner";
import { apiClient, unwrap } from "@/lib/api/client";
import type { components } from "@/lib/api/v1";
import { authClient } from "@/lib/auth-client";

type GitHubRepository = components["schemas"]["GitHubRepositoryDTO"];

/** The optional GitHub repository to import. Until a GitHub account is linked it offers to link one instead, since the import reads with that account's token. */
export function GitHubSourceField({
  id,
  connected,
  error,
  value,
  onChange,
}: {
  id: string;
  connected: boolean;
  error?: { message?: string };
  value: string;
  onChange: (source: string) => void;
}) {
  const [linking, setLinking] = useState(false);

  return (
    <Field>
      <FieldLabel htmlFor={id}>
        Import from GitHub
        <span className="font-normal text-muted-foreground">(optional)</span>
      </FieldLabel>
      {connected ? (
        <RepositoryPicker
          id={id}
          value={value}
          onChange={onChange}
          invalid={Boolean(error)}
        />
      ) : (
        <Button
          type="button"
          variant="outline"
          className="w-fit"
          disabled={linking}
          onClick={() => {
            setLinking(true);
            // `repo` lets the import read private repositories as well as public ones.
            void authClient
              .linkSocial({
                provider: "github",
                scopes: ["repo"],
                callbackURL: window.location.href,
              })
              .then(({ error }) => {
                if (!error) return;
                setLinking(false);
                toast.error(error.message ?? "GitHub could not be linked");
              });
          }}
        >
          {linking && <Spinner />}
          Connect GitHub to import
        </Button>
      )}
      <FieldDescription>
        Brings over the code, releases, issues and pull requests. Leave empty
        for an empty repository.
      </FieldDescription>
      <FieldError errors={[error]} />
    </Field>
  );
}

/** Picks from the linked account's repositories rather than taking a typed name, so a typo cannot start an import of the wrong thing. The list is fetched once and filtered as the user types. */
function RepositoryPicker({
  id,
  value,
  onChange,
  invalid,
}: {
  id: string;
  value: string;
  onChange: (source: string) => void;
  invalid: boolean;
}) {
  // A modal dialog makes everything outside it inert, so the list renders inside the field rather than at the end of <body>, where it could be neither scrolled nor clicked.
  const [container, setContainer] = useState<HTMLDivElement | null>(null);

  const {
    data: repositories = [],
    isPending,
    error,
  } = useQuery({
    queryKey: ["github-repositories"],
    queryFn: async () => {
      const data = await unwrap(
        apiClient.GET("/api/imports/github/repositories"),
      );
      return data.repositories;
    },
  });

  const selected =
    repositories.find((repository) => repository.fullName === value) ??
    (value ? { fullName: value, private: false, description: null } : null);

  return (
    <Combobox<GitHubRepository>
      items={repositories}
      value={selected}
      onValueChange={(repository) => onChange(repository?.fullName ?? "")}
      itemToStringLabel={(repository) => repository.fullName}
      isItemEqualToValue={(item, current) => item.fullName === current.fullName}
    >
      <ComboboxInput
        id={id}
        className="w-full"
        placeholder="Search your GitHub repositories"
        aria-invalid={invalid}
        showClear={Boolean(value)}
      />
      <div ref={setContainer} />
      <ComboboxContent container={container}>
        <ComboboxEmpty>
          {isPending
            ? "Loading your GitHub repositories..."
            : error
              ? error.message
              : "No repositories found."}
        </ComboboxEmpty>
        <ComboboxList>
          {(repository: GitHubRepository) => (
            <ComboboxItem key={repository.fullName} value={repository}>
              <div className="min-w-0">
                <div className="flex items-center gap-1.5">
                  <span className="truncate">{repository.fullName}</span>
                  {repository.private && (
                    <LockIcon
                      className="size-3 text-muted-foreground"
                      aria-label="Private"
                    />
                  )}
                </div>
                {repository.description && (
                  <p className="truncate text-xs text-muted-foreground">
                    {repository.description}
                  </p>
                )}
              </div>
            </ComboboxItem>
          )}
        </ComboboxList>
      </ComboboxContent>
    </Combobox>
  );
}
