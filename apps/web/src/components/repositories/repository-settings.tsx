"use client";

import { BookLock, Globe, Trash2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { useAction } from "next-safe-action/hooks";
import { useState } from "react";
import { toast } from "sonner";

import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogMedia,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import {
  Field,
  FieldDescription,
  FieldError,
  FieldLabel,
} from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import {
  Item,
  ItemActions,
  ItemContent,
  ItemDescription,
  ItemMedia,
  ItemSeparator,
  ItemTitle,
} from "@/components/ui/item";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Spinner } from "@/components/ui/spinner";
import { Textarea } from "@/components/ui/textarea";

import {
  deleteRepository,
  transferRepository,
  updateRepository,
} from "./actions";
import { type UpdateRepositoryInput, updateRepositorySchema } from "./common";
import { SettingCard } from "./setting-card";

type Visibility = "public" | "private";

type RepositoryProps = {
  username: string;
  slug: string;
};

export function RepositoryGeneralSettings({
  username,
  slug,
  name,
  description,
  visibility,
  defaultBranch,
  branches,
  isAdmin,
  transferTargets,
  canTransfer,
}: RepositoryProps & {
  name: string;
  description?: string | null;
  visibility: Visibility;
  defaultBranch: string | null;
  branches: string[];
  /** Visibility and deletion are an admin's; a maintainer sees the rest. */
  isAdmin: boolean;
  /** Where the viewer may move the repository at once. */
  transferTargets: string[];
  /** Transferring is the owner's alone. */
  canTransfer: boolean;
}) {
  return (
    <div className="flex flex-col gap-8">
      <NameSetting username={username} slug={slug} name={name} />
      <DescriptionSetting
        username={username}
        slug={slug}
        description={description ?? ""}
      />
      {branches.length > 0 && (
        <DefaultBranchSetting
          username={username}
          slug={slug}
          defaultBranch={defaultBranch}
          branches={branches}
        />
      )}
      {isAdmin && (
        <>
          <VisibilitySetting
            username={username}
            slug={slug}
            visibility={visibility}
          />
          <DangerZone
            username={username}
            slug={slug}
            transferTargets={transferTargets}
            canTransfer={canTransfer}
          />
        </>
      )}
    </div>
  );
}

/** Saves one change, then follows the repository to its new URL if a rename moved it. */
function useSave({ username, slug }: RepositoryProps, saved: string) {
  const router = useRouter();

  const action = useAction(updateRepository, {
    onSuccess: ({ data }) => {
      toast.success(saved);
      if (data && data.slug !== slug) {
        router.replace(`/${username}/${data.slug}/settings`);
      } else {
        router.refresh();
      }
    },
    onError: ({ error }) =>
      toast.error(error.serverError ?? "Could not save this change."),
  });

  return {
    ...action,
    save: (changes: UpdateRepositoryInput) =>
      action.execute({ username, slug, ...changes }),
  };
}

function NameSetting({
  name,
  ...repository
}: RepositoryProps & { name: string }) {
  const [value, setValue] = useState(name);
  const { save, isExecuting } = useSave(repository, "Repository renamed");
  const parsed = updateRepositorySchema.shape.name.safeParse(value);
  const error = parsed.success ? undefined : parsed.error.issues[0]?.message;

  return (
    <SettingCard
      title="Repository name"
      hint="Renaming changes the URL. Links and git remotes using the old one stop working."
      onSubmit={() => save({ name: value })}
      pending={isExecuting}
      canSave={value !== name && !error}
      submitText="Rename"
    >
      <Field data-invalid={Boolean(error)}>
        <FieldLabel htmlFor="settings-name" className="sr-only">
          Repository name
        </FieldLabel>
        <Input
          id="settings-name"
          autoComplete="off"
          value={value}
          aria-invalid={Boolean(error)}
          onChange={(event) => setValue(event.target.value)}
          className="max-w-md"
        />
        {error && <FieldError>{error}</FieldError>}
      </Field>
    </SettingCard>
  );
}

function DescriptionSetting({
  description,
  ...repository
}: RepositoryProps & { description: string }) {
  const [value, setValue] = useState(description);
  const { save, isExecuting } = useSave(repository, "Description saved");
  const tooLong = value.length > 350;

  return (
    <SettingCard
      title="Description"
      hint={`Shown under the repository name and in search. ${value.length}/350`}
      onSubmit={() => save({ description: value })}
      pending={isExecuting}
      canSave={value !== description && !tooLong}
    >
      <Field data-invalid={tooLong}>
        <FieldLabel htmlFor="settings-description" className="sr-only">
          Description
        </FieldLabel>
        <Textarea
          id="settings-description"
          rows={3}
          placeholder="What this repository is for"
          value={value}
          aria-invalid={tooLong}
          onChange={(event) => setValue(event.target.value)}
        />
        {tooLong && (
          <FieldError>Descriptions are limited to 350 characters.</FieldError>
        )}
      </Field>
    </SettingCard>
  );
}

function DefaultBranchSetting({
  defaultBranch,
  branches,
  ...repository
}: RepositoryProps & { defaultBranch: string | null; branches: string[] }) {
  const [value, setValue] = useState(defaultBranch ?? "");
  const { save, isExecuting } = useSave(repository, "Default branch updated");

  return (
    <SettingCard
      title="Default branch"
      hint="The branch the repository opens on and clones check out."
      onSubmit={() => save({ defaultBranch: value })}
      pending={isExecuting}
      canSave={Boolean(value) && value !== defaultBranch}
      submitText="Update"
    >
      <Field>
        <FieldLabel htmlFor="settings-default-branch" className="sr-only">
          Default branch
        </FieldLabel>
        <Select value={value} onValueChange={setValue}>
          <SelectTrigger
            id="settings-default-branch"
            className="w-full sm:w-64"
          >
            <SelectValue placeholder="Select a branch" />
          </SelectTrigger>
          <SelectContent>
            {branches.map((branch) => (
              <SelectItem key={branch} value={branch}>
                {branch}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </Field>
    </SettingCard>
  );
}

const visibilityCopy = {
  public: {
    icon: Globe,
    title: "Public",
    description: "Anyone on the internet can see and clone this repository.",
  },
  private: {
    icon: BookLock,
    title: "Private",
    description: "Only you and the collaborators you invite can see it.",
  },
} satisfies Record<Visibility, unknown>;

function VisibilitySetting({
  visibility,
  ...repository
}: RepositoryProps & { visibility: Visibility }) {
  const next: Visibility = visibility === "public" ? "private" : "public";
  const { save, isExecuting } = useSave(
    repository,
    `Repository is now ${next}`,
  );
  const current = visibilityCopy[visibility];

  return (
    <section>
      <h2 className="mb-3 text-sm font-semibold">Visibility</h2>
      <Card className="py-0">
        <Item>
          <ItemMedia variant="icon">
            <current.icon />
          </ItemMedia>
          <ItemContent>
            <ItemTitle>{current.title}</ItemTitle>
            <ItemDescription>{current.description}</ItemDescription>
          </ItemContent>
          <ItemActions>
            <AlertDialog>
              <AlertDialogTrigger asChild>
                <Button size="sm" variant="outline" disabled={isExecuting}>
                  {isExecuting && <Spinner />}
                  Make {next}
                </Button>
              </AlertDialogTrigger>
              <AlertDialogContent>
                <AlertDialogHeader>
                  <AlertDialogTitle>
                    Make {repository.username}/{repository.slug} {next}?
                  </AlertDialogTitle>
                  <AlertDialogDescription>
                    {next === "public"
                      ? "Its code, issues and pull requests become visible to anyone, and its code becomes searchable."
                      : "Only you and its collaborators will be able to see it."}
                  </AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                  <AlertDialogCancel>Cancel</AlertDialogCancel>
                  <Button onClick={() => save({ visibility: next })}>
                    Make {next}
                  </Button>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>
          </ItemActions>
        </Item>
      </Card>
    </section>
  );
}

function DangerZone({
  transferTargets,
  canTransfer,
  ...repository
}: RepositoryProps & { transferTargets: string[]; canTransfer: boolean }) {
  return (
    <section>
      <h2 className="mb-3 text-sm font-semibold text-destructive">
        Danger zone
      </h2>
      <Card className="gap-0 border-destructive/50 py-0">
        {canTransfer && (
          <>
            <Item>
              <ItemContent>
                <ItemTitle>Transfer ownership</ItemTitle>
                <ItemDescription>
                  Move it to your account or an organization you administer. The
                  URL changes, and git remotes need updating.
                </ItemDescription>
              </ItemContent>
              <ItemActions>
                <TransferRepositoryDialog
                  {...repository}
                  suggestions={transferTargets}
                />
              </ItemActions>
            </Item>
            <ItemSeparator className="my-0!" />
          </>
        )}
        <Item>
          <ItemContent>
            <ItemTitle>Delete this repository</ItemTitle>
            <ItemDescription>
              Its code, issues, pull requests and stars are gone for good. Forks
              are kept.
            </ItemDescription>
          </ItemContent>
          <ItemActions>
            <DeleteRepositoryDialog {...repository} />
          </ItemActions>
        </Item>
      </Card>
    </section>
  );
}

/** `suggestions` are where it moves at once: the viewer's own account and organizations they administer. Any other user or organization can be typed, and accepts it first. */
function TransferRepositoryDialog({
  username,
  slug,
  suggestions,
}: RepositoryProps & { suggestions: string[] }) {
  const [open, setOpen] = useState(false);
  const [target, setTarget] = useState(suggestions[0] ?? "");
  const [confirmation, setConfirmation] = useState("");
  const { execute, isExecuting, result } = useAction(transferRepository, {
    onSuccess: ({ data }) => {
      if (!data?.pending) return;
      toast.success(`Transfer requested; it moves once ${data.owner} accepts`);
      setOpen(false);
    },
  });
  const fullName = `${username}/${slug}`;
  const immediate = suggestions.includes(target.trim());

  return (
    <AlertDialog
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        setConfirmation("");
      }}
    >
      <AlertDialogTrigger asChild>
        <Button variant="outline" size="sm">
          Transfer
        </Button>
      </AlertDialogTrigger>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Transfer {fullName}</AlertDialogTitle>
          <AlertDialogDescription>
            Its issues, pull requests, stars and collaborators move with it, and
            the old URL keeps redirecting.
          </AlertDialogDescription>
        </AlertDialogHeader>

        <Field>
          <FieldLabel htmlFor="transfer-target">New owner</FieldLabel>
          <Input
            id="transfer-target"
            list="transfer-suggestions"
            autoComplete="off"
            placeholder="A username or organization"
            value={target}
            onChange={(event) => setTarget(event.target.value)}
          />
          <datalist id="transfer-suggestions">
            {suggestions.map((owner) => (
              <option key={owner} value={owner} />
            ))}
          </datalist>
          <FieldDescription>
            {immediate
              ? "It moves right away."
              : "They have to accept it before it moves."}
          </FieldDescription>
        </Field>
        <Field>
          <FieldLabel htmlFor="transfer-confirmation">
            Type <span className="font-mono">{fullName}</span> to confirm
          </FieldLabel>
          <Input
            id="transfer-confirmation"
            autoComplete="off"
            value={confirmation}
            onChange={(event) => setConfirmation(event.target.value)}
          />
          {result.serverError && <FieldError>{result.serverError}</FieldError>}
        </Field>

        <AlertDialogFooter>
          <AlertDialogCancel disabled={isExecuting}>Cancel</AlertDialogCancel>
          <Button
            type="button"
            disabled={
              isExecuting || !target.trim() || confirmation !== fullName
            }
            onClick={() => execute({ username, slug, owner: target.trim() })}
          >
            {isExecuting && <Spinner />}
            {immediate ? `Transfer to ${target.trim()}` : "Request transfer"}
          </Button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

function DeleteRepositoryDialog({ username, slug }: RepositoryProps) {
  const [confirmation, setConfirmation] = useState("");
  const { execute, isExecuting, result } = useAction(deleteRepository);
  const fullName = `${username}/${slug}`;

  return (
    <AlertDialog onOpenChange={() => setConfirmation("")}>
      <AlertDialogTrigger asChild>
        <Button variant="destructive" size="sm">
          Delete
        </Button>
      </AlertDialogTrigger>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogMedia>
            <Trash2 />
          </AlertDialogMedia>
          <AlertDialogTitle>Delete {fullName}?</AlertDialogTitle>
          <AlertDialogDescription>
            This cannot be undone. The code, issues, pull requests and stars are
            removed.
          </AlertDialogDescription>
        </AlertDialogHeader>

        <Field>
          <FieldLabel htmlFor="delete-confirmation">
            Type <span className="font-mono">{fullName}</span> to confirm
          </FieldLabel>
          <Input
            id="delete-confirmation"
            autoComplete="off"
            value={confirmation}
            onChange={(event) => setConfirmation(event.target.value)}
          />
          {result.serverError && <FieldError>{result.serverError}</FieldError>}
        </Field>

        <AlertDialogFooter>
          <AlertDialogCancel disabled={isExecuting}>Cancel</AlertDialogCancel>
          <Button
            type="button"
            variant="destructive"
            disabled={isExecuting || confirmation !== fullName}
            onClick={() => execute({ username, slug })}
          >
            {isExecuting && <Spinner />}
            Delete repository
          </Button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
