"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useAction } from "next-safe-action/hooks";
import { useState } from "react";
import { Controller, useForm } from "react-hook-form";
import { toast } from "sonner";

import { BranchSelect } from "@/components/repositories/branch-select";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Field,
  FieldDescription,
  FieldError,
  FieldGroup,
  FieldLabel,
} from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { MarkdownEditor } from "@/components/markdown-editor/markdown-editor";
import { Skeleton } from "@/components/ui/skeleton";
import { Spinner } from "@/components/ui/spinner";
import type { Release, StorageUsage } from "@/types/release";

import { createRelease, updateRelease } from "./actions";
import {
  assetProblem,
  type ReleaseInput,
  releasePath,
  releaseSchema,
} from "./common";
import { ReleaseAssetPicker } from "./release-asset-picker";
import { uploadReleaseAsset } from "./upload-asset";

/** Creates a release, or edits `release` when given. The tag of an existing release is fixed. Picked files upload once the release is saved. */
export function ReleaseForm({
  username,
  repo,
  branches,
  defaultBranch,
  release,
  isFork,
  storage,
}: {
  username: string;
  repo: string;
  branches: string[];
  defaultBranch: string | null;
  release?: Release;
  /** A fork's assets count against its fork quota, not the asset quota. */
  isFork: boolean;
  /** Null when the viewer may not see the owner's usage, such as a collaborator outside the organization. */
  storage: StorageUsage | null;
}) {
  const {
    register,
    control,
    handleSubmit,
    formState: { errors },
  } = useForm<ReleaseInput>({
    resolver: zodResolver(releaseSchema),
    defaultValues: {
      tagName: release?.tagName ?? "",
      target: defaultBranch ?? undefined,
      name: release?.name ?? "",
      body: release?.body ?? "",
      isPrerelease: release?.isPrerelease ?? false,
    },
  });

  const router = useRouter();
  const [files, setFiles] = useState<File[]>([]);
  const [uploading, setUploading] = useState<string | null>(null);
  const create = useAction(createRelease);
  const update = useAction(updateRelease);
  const isExecuting =
    create.isExecuting || update.isExecuting || uploading !== null;
  const serverError =
    create.result.serverError ?? update.result.serverError ?? null;
  const quota = storage && {
    ...(isFork ? storage.fork : storage.asset),
    maxAssetBytes: storage.maxAssetBytes,
  };
  const problem = assetProblem(files, release?.assets ?? [], quota);

  const submit = (isDraft: boolean) =>
    handleSubmit(async (input) => {
      if (problem) return;

      const saved = release
        ? await update.executeAsync({
            username,
            repo,
            id: release.id,
            name: input.name,
            body: input.body,
            isPrerelease: input.isPrerelease,
            isDraft,
          })
        : await create.executeAsync({ username, repo, ...input, isDraft });
      if (!saved?.data) return;

      // ponytail: one file at a time with no progress bar; XHR upload events would give one if large files feel stuck
      for (const file of files) {
        setUploading(file.name);
        try {
          await uploadReleaseAsset({
            username,
            repo,
            releaseId: saved.data.id,
            file,
          });
          // by identity: two picked files can share a name
          setFiles((current) => current.filter((picked) => picked !== file));
        } catch (error) {
          setUploading(null);
          // the release is saved, so what is left to fix lives on its edit page; the files that did not make it stay picked for a retry there
          toast.error((error as Error).message);
          router.push(releasePath(username, repo, saved.data.tagName, "edit"));
          router.refresh();
          return;
        }
      }

      router.push(releasePath(username, repo, saved.data.tagName));
      router.refresh();
    });

  return (
    <form onSubmit={submit(false)} className="contents">
      <FieldGroup>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field>
            <FieldLabel htmlFor="release-tag">Tag</FieldLabel>
            <Input
              id="release-tag"
              placeholder="v1.0.0"
              autoComplete="off"
              disabled={Boolean(release)}
              aria-invalid={Boolean(errors.tagName)}
              {...register("tagName")}
            />
            <FieldError errors={[errors.tagName]} />
          </Field>

          {!release && branches.length > 0 && (
            <Field>
              <FieldLabel htmlFor="release-target">Target</FieldLabel>
              <Controller
                control={control}
                name="target"
                render={({ field }) => (
                  <BranchSelect
                    id="release-target"
                    branches={branches}
                    value={field.value ?? ""}
                    onValueChange={field.onChange}
                  />
                )}
              />
              <FieldDescription>
                Used only when the tag does not exist yet.
              </FieldDescription>
            </Field>
          )}
        </div>

        <Field>
          <FieldLabel htmlFor="release-name">
            Title
            <span className="font-normal text-muted-foreground">
              (optional, defaults to the tag)
            </span>
          </FieldLabel>
          <Input
            id="release-name"
            autoComplete="off"
            aria-invalid={Boolean(errors.name)}
            {...register("name")}
          />
          <FieldError errors={[errors.name]} />
        </Field>

        <Field>
          <FieldLabel htmlFor="release-body">Notes</FieldLabel>
          <Controller
            control={control}
            name="body"
            render={({ field }) => (
              <MarkdownEditor
                id="release-body"
                value={field.value ?? ""}
                onChange={field.onChange}
                repository={{ username, repo }}
                rows={12}
                maxLength={100000}
                placeholder="What changed in this release?"
                invalid={Boolean(errors.body)}
                disabled={isExecuting}
              />
            )}
          />
          <FieldError errors={[errors.body]} />
        </Field>

        <Field>
          <FieldLabel>Assets</FieldLabel>
          <ReleaseAssetPicker
            username={username}
            repo={repo}
            existing={release?.assets ?? []}
            files={files}
            onFilesChange={setFiles}
            storage={quota}
            problem={problem}
            disabled={isExecuting}
          />
        </Field>

        <Controller
          control={control}
          name="isPrerelease"
          render={({ field }) => (
            <Field orientation="horizontal">
              <Checkbox
                id="release-prerelease"
                checked={field.value}
                onCheckedChange={(checked) => field.onChange(checked === true)}
              />
              <FieldLabel htmlFor="release-prerelease" className="font-normal">
                This is a prerelease, and never marked as the latest
              </FieldLabel>
            </Field>
          )}
        />

        {serverError && <FieldError>{serverError}</FieldError>}
      </FieldGroup>

      <div className="mt-6 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
        <Button type="button" variant="outline" asChild>
          <Link
            href={
              release
                ? releasePath(username, repo, release.tagName)
                : `/${username}/${repo}/releases`
            }
          >
            Cancel
          </Link>
        </Button>
        {(!release || release.isDraft) && (
          <Button
            type="button"
            variant="outline"
            disabled={isExecuting}
            // a button outside submit skips the form's validation, which holds back text with uploads still in it
            onClick={(event) =>
              event.currentTarget.form?.reportValidity() && submit(true)(event)
            }
          >
            Save draft
          </Button>
        )}
        <Button type="submit" disabled={isExecuting}>
          {isExecuting && <Spinner />}
          {uploading
            ? `Uploading ${uploading}…`
            : release && !release.isDraft
              ? "Update release"
              : "Publish release"}
        </Button>
      </div>
    </form>
  );
}

export function ReleaseFormSkeleton() {
  return (
    <div className="flex flex-col gap-6">
      <div className="grid gap-4 sm:grid-cols-2">
        <Skeleton className="h-9 w-full" />
        <Skeleton className="h-9 w-full" />
      </div>
      <Skeleton className="h-9 w-full" />
      <Skeleton className="h-64 w-full" />
      <Skeleton className="ml-auto h-9 w-36" />
    </div>
  );
}
