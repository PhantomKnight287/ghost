"use client";

import { Package, Paperclip, X } from "lucide-react";
import { useRouter } from "next/navigation";
import { useAction } from "next-safe-action/hooks";

import { Dropzone, DropzoneEmptyState } from "@/components/kibo-ui/dropzone";
import { Button } from "@/components/ui/button";
import { FieldDescription, FieldError } from "@/components/ui/field";
import { Spinner } from "@/components/ui/spinner";
import { formatBytes } from "@/lib/utils";
import type { ReleaseAsset, StorageUsage } from "@/types/release";

import { deleteReleaseAsset } from "./actions";

/** The files a release form will attach: the ones already stored, which delete at once, and the ones picked, which upload when the form is saved. */
export function ReleaseAssetPicker({
  username,
  repo,
  existing,
  files,
  onFilesChange,
  storage,
  problem,
  disabled,
}: {
  username: string;
  repo: string;
  existing: ReleaseAsset[];
  files: File[];
  onFilesChange: (files: File[]) => void;
  storage: StorageUsage | null;
  problem: string | null;
  disabled: boolean;
}) {
  const router = useRouter();
  const remove = useAction(deleteReleaseAsset, {
    onSuccess: () => router.refresh(),
  });

  return (
    <div className="flex flex-col gap-2">
      {(existing.length > 0 || files.length > 0) && (
        <ul className="divide-y rounded-lg border">
          {existing.map((asset) => (
            <li
              key={asset.id}
              className="flex items-center gap-3 px-3 py-2 text-sm"
            >
              <Package className="size-4 shrink-0 text-muted-foreground" />
              <span className="min-w-0 flex-1 truncate">{asset.name}</span>
              <span className="text-xs text-muted-foreground tabular-nums">
                {formatBytes(asset.size)}
              </span>
              <Button
                type="button"
                variant="ghost"
                size="icon-sm"
                aria-label={`Delete ${asset.name}`}
                disabled={remove.isExecuting}
                onClick={() =>
                  remove.execute({ username, repo, assetId: asset.id })
                }
              >
                {remove.isExecuting && remove.input?.assetId === asset.id ? (
                  <Spinner />
                ) : (
                  <X />
                )}
              </Button>
            </li>
          ))}
          {files.map((file, index) => (
            <li
              key={`${file.name}-${index}`}
              className="flex items-center gap-3 px-3 py-2 text-sm"
            >
              <Paperclip className="size-4 shrink-0 text-muted-foreground" />
              <span className="min-w-0 flex-1 truncate">{file.name}</span>
              <span className="text-xs text-muted-foreground tabular-nums">
                {formatBytes(file.size)}
              </span>
              <Button
                type="button"
                variant="ghost"
                size="icon-sm"
                aria-label={`Remove ${file.name}`}
                onClick={() =>
                  onFilesChange(files.filter((_, other) => other !== index))
                }
              >
                <X />
              </Button>
            </li>
          ))}
        </ul>
      )}

      <Dropzone
        maxFiles={0}
        disabled={disabled}
        onDrop={(dropped) => onFilesChange([...files, ...dropped])}
      >
        <DropzoneEmptyState />
      </Dropzone>
      {storage && (
        <FieldDescription>
          Up to {formatBytes(storage.maxAssetBytes)} per file
          {storage.asset.quotaBytes !== null &&
            ` · ${formatBytes(storage.asset.usedBytes)} of ${formatBytes(storage.asset.quotaBytes)} used`}
        </FieldDescription>
      )}

      {problem && <FieldError>{problem}</FieldError>}
      {remove.result.serverError && (
        <FieldError>{remove.result.serverError}</FieldError>
      )}
    </div>
  );
}
