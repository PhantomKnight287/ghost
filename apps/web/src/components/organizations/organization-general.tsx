"use client";

import { useAuth } from "@better-auth-ui/react";
import { Trash2, Upload } from "lucide-react";
import { useRouter } from "next/navigation";
import { type ChangeEvent, useRef, useState } from "react";
import { toast } from "sonner";

import { SettingCard } from "@/components/repositories/setting-card";
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
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Field, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import {
  Item,
  ItemActions,
  ItemContent,
  ItemDescription,
  ItemMedia,
  ItemTitle,
} from "@/components/ui/item";
import { Spinner } from "@/components/ui/spinner";
import { apiClient, apiErrorMessage } from "@/lib/api/client";
import type { components } from "@/lib/api/v1";
import { authClient } from "@/lib/auth-client";
import { deleteImage, putImage } from "@/lib/auth/avatar";

import {
  OrganizationPrivileges,
  OrganizationProfileSettings,
  PinnedRepositoriesSetting,
} from "./organization-policies";
import { useOrganization } from "./use-organization";

type OrganizationSettings = components["schemas"]["OrganizationSettingsDTO"];

export function OrganizationGeneral({
  slug,
  name,
  isOwner,
  settings,
  repositories,
  pinned,
}: {
  slug: string;
  name: string;
  /** Deleting the organization is its owners' alone. */
  isOwner: boolean;
  settings: OrganizationSettings;
  /** Slugs of every repository it owns, which have to go before it can. */
  repositories: string[];
  pinned: string[];
}) {
  const router = useRouter();
  const { organization, change, busy } = useOrganization(slug);
  const [displayName, setDisplayName] = useState(name);
  const [newSlug, setNewSlug] = useState(slug);
  const organizationId = organization?.id ?? "";

  return (
    <div className="flex flex-col gap-8">
      <LogoSetting slug={slug} />

      <SettingCard
        title="Display name"
        hint="Shown on the organization's profile."
        onSubmit={() =>
          change(
            () =>
              authClient.organization.update({
                organizationId,
                data: { name: displayName.trim() },
              }),
            "Name saved",
          ).then((ok) => ok && router.refresh())
        }
        pending={busy}
        canSave={Boolean(organization) && displayName.trim() !== name}
      >
        <Field>
          <FieldLabel htmlFor="organization-name" className="sr-only">
            Display name
          </FieldLabel>
          <Input
            id="organization-name"
            value={displayName}
            onChange={(event) => setDisplayName(event.target.value)}
            className="max-w-md"
          />
        </Field>
      </SettingCard>

      <SettingCard
        title="Organization name"
        hint="The name in its URLs. Renaming changes the address of every repository it owns, and git remotes need updating."
        onSubmit={() =>
          change(
            () =>
              authClient.organization.update({
                organizationId,
                data: { slug: newSlug.trim() },
              }),
            "Organization renamed",
          ).then((ok) => ok && router.replace(`/${newSlug.trim()}/settings`))
        }
        pending={busy}
        canSave={
          Boolean(organization) &&
          Boolean(newSlug.trim()) &&
          newSlug.trim() !== slug
        }
        submitText="Rename"
      >
        <Field>
          <FieldLabel htmlFor="organization-slug" className="sr-only">
            Organization name
          </FieldLabel>
          <Input
            id="organization-slug"
            autoComplete="off"
            value={newSlug}
            onChange={(event) => setNewSlug(event.target.value)}
            className="max-w-md"
          />
        </Field>
      </SettingCard>

      <OrganizationProfileSettings slug={slug} settings={settings} />
      <OrganizationPrivileges slug={slug} settings={settings} />
      <PinnedRepositoriesSetting
        slug={slug}
        repositories={repositories}
        pinned={pinned}
      />

      {isOwner && (
        <section>
          <h2 className="mb-3 text-sm font-semibold text-destructive">
            Danger zone
          </h2>
          <Card className="border-destructive/50 py-0">
            <Item>
              <ItemContent>
                <ItemTitle>Delete this organization</ItemTitle>
                <ItemDescription>
                  Its members, teams and invitations go with it, and so do its
                  repositories unless you transfer them first.
                </ItemDescription>
              </ItemContent>
              <ItemActions>
                <DeleteOrganizationDialog
                  slug={slug}
                  repositories={repositories}
                  disabled={!organization || busy}
                  onDelete={async () => {
                    // Each repository goes through its own delete, which purges what it stored; the organization refuses to go while any remain.
                    for (const repository of repositories) {
                      const { error } = await apiClient.DELETE(
                        "/api/repositories/{username}/{slug}",
                        {
                          params: {
                            path: { username: slug, slug: repository },
                          },
                        },
                      );
                      if (error) {
                        toast.error(`${repository}: ${apiErrorMessage(error)}`);
                        router.refresh();
                        return;
                      }
                    }
                    const ok = await change(
                      () => authClient.organization.delete({ organizationId }),
                      "Organization deleted",
                    );
                    if (ok) router.push("/dashboard");
                  }}
                />
              </ItemActions>
            </Item>
          </Card>
        </section>
      )}
    </div>
  );
}

function DeleteOrganizationDialog({
  slug,
  repositories,
  disabled,
  onDelete,
}: {
  slug: string;
  repositories: string[];
  disabled: boolean;
  onDelete: () => Promise<unknown>;
}) {
  const [confirmation, setConfirmation] = useState("");
  const [deleting, setDeleting] = useState(false);

  return (
    <AlertDialog onOpenChange={() => setConfirmation("")}>
      <AlertDialogTrigger asChild>
        <Button variant="destructive" size="sm" disabled={disabled}>
          Delete
        </Button>
      </AlertDialogTrigger>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogMedia>
            <Trash2 />
          </AlertDialogMedia>
          <AlertDialogTitle>Delete {slug}?</AlertDialogTitle>
          <AlertDialogDescription>
            This cannot be undone.{" "}
            {repositories.length > 0
              ? `Its ${repositories.length === 1 ? "repository is" : `${repositories.length} repositories are`} deleted with it, code and all. Transfer any you want to keep first.`
              : "It owns no repositories."}
          </AlertDialogDescription>
        </AlertDialogHeader>
        {repositories.length > 0 && (
          <ul className="max-h-40 overflow-y-auto rounded-md border px-3 py-2 font-mono text-xs">
            {repositories.map((repository) => (
              <li key={repository}>
                {slug}/{repository}
              </li>
            ))}
          </ul>
        )}
        <Field>
          <FieldLabel htmlFor="delete-organization-confirmation">
            Type <span className="font-mono">{slug}</span> to confirm
          </FieldLabel>
          <Input
            id="delete-organization-confirmation"
            autoComplete="off"
            value={confirmation}
            onChange={(event) => setConfirmation(event.target.value)}
          />
        </Field>
        <AlertDialogFooter>
          <AlertDialogCancel disabled={deleting}>Cancel</AlertDialogCancel>
          <Button
            variant="destructive"
            disabled={deleting || confirmation !== slug}
            onClick={() => {
              setDeleting(true);
              onDelete().finally(() => setDeleting(false));
            }}
          >
            {deleting && <Spinner />}
            Delete organization
          </Button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

/** Upload or remove the logo. Uploads are resized to the same square as account avatars before they are sent. */
function LogoSetting({ slug }: { slug: string }) {
  const router = useRouter();
  const { avatar } = useAuth();
  const { organization, change, busy } = useOrganization(slug);
  const fileInput = useRef<HTMLInputElement>(null);
  const path = `/api/organizations/${slug}/logo`;

  const run = (action: () => Promise<unknown>, done: string) =>
    change(async () => {
      try {
        await action();
        return { error: null };
      } catch (error) {
        return {
          error: {
            message: error instanceof Error ? error.message : undefined,
          },
        };
      }
    }, done).then((ok) => ok && router.refresh());

  async function upload(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;

    const resized =
      (await avatar.resize?.(file, avatar.size, avatar.extension)) ?? file;
    await run(() => putImage(path, resized), "Logo updated");
  }

  return (
    <section>
      <h2 className="mb-3 text-sm font-semibold">Logo</h2>
      <Card className="py-0">
        <Item>
          <ItemMedia>
            <Avatar className="size-16 rounded-xl">
              <AvatarImage src={organization?.logo ?? undefined} alt="" />
              <AvatarFallback className="text-lg">
                {slug.slice(0, 2).toUpperCase()}
              </AvatarFallback>
            </Avatar>
          </ItemMedia>
          <ItemContent>
            <ItemDescription>
              Shown on the organization&apos;s profile and next to its
              repositories. PNG or JPEG.
            </ItemDescription>
          </ItemContent>
          <ItemActions>
            <input
              ref={fileInput}
              type="file"
              accept="image/png,image/jpeg"
              className="hidden"
              onChange={upload}
            />
            <Button
              size="sm"
              variant="outline"
              disabled={!organization || busy}
              onClick={() => fileInput.current?.click()}
            >
              {busy ? <Spinner /> : <Upload />}
              Upload
            </Button>
            {organization?.logo && (
              <Button
                size="sm"
                variant="ghost"
                disabled={busy}
                onClick={() => run(() => deleteImage(path), "Logo removed")}
              >
                Remove
              </Button>
            )}
          </ItemActions>
        </Item>
      </Card>
    </section>
  );
}
