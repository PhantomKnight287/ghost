"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { toast } from "sonner";

import { SettingCard } from "@/components/repositories/setting-card";
import { RoleSelect } from "@/components/role-select";
import {
  Field,
  FieldContent,
  FieldDescription,
  FieldGroup,
  FieldLabel,
  FieldTitle,
} from "@/components/ui/field";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { apiClient, apiErrorMessage } from "@/lib/api/client";
import type { components } from "@/lib/api/v1";
import {
  type CollaboratorRole,
  collaboratorRoles,
  roleLabels,
} from "@/lib/repository-role";

type Settings = components["schemas"]["OrganizationSettingsDTO"];
type Changes = components["schemas"]["UpdateOrganizationSettingsDTO"];

const NONE = "none";

/** Saves a slice of the settings and re-renders the page from what was stored. */
function useSaveSettings(slug: string) {
  const router = useRouter();
  const [saving, setSaving] = useState(false);

  const save = async (changes: Changes, done: string) => {
    setSaving(true);
    const { error } = await apiClient.PATCH(
      "/api/organizations/{slug}/settings",
      { params: { path: { slug } }, body: changes },
    );
    setSaving(false);
    if (error) return toast.error(apiErrorMessage(error));
    toast.success(done);
    router.refresh();
  };

  return { save, saving };
}

/** What outsiders see on the profile: a description and where to find the organization. Blank fields are cleared. */
export function OrganizationProfileSettings({
  slug,
  settings,
}: {
  slug: string;
  settings: Settings;
}) {
  const { save, saving } = useSaveSettings(slug);
  const [profile, setProfile] = useState({
    description: settings.description ?? "",
    website: settings.website ?? "",
    location: settings.location ?? "",
    email: settings.email ?? "",
  });
  const changed = (Object.keys(profile) as (keyof typeof profile)[]).some(
    (key) => profile[key] !== (settings[key] ?? ""),
  );
  const field = (key: keyof typeof profile) => ({
    id: `organization-${key}`,
    value: profile[key],
    onChange: (
      event: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>,
    ) => setProfile({ ...profile, [key]: event.target.value }),
  });

  return (
    <SettingCard
      title="Profile"
      hint="Shown to everyone on the organization's page."
      onSubmit={() =>
        save(
          {
            description: profile.description.trim() || null,
            website: profile.website.trim() || null,
            location: profile.location.trim() || null,
            email: profile.email.trim() || null,
          },
          "Profile saved",
        )
      }
      pending={saving}
      canSave={changed}
    >
      <FieldGroup>
        <Field>
          <FieldLabel htmlFor="organization-description">
            Description
          </FieldLabel>
          <Textarea rows={2} maxLength={350} {...field("description")} />
        </Field>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field>
            <FieldLabel htmlFor="organization-website">Website</FieldLabel>
            <Input
              type="url"
              placeholder="https://example.com"
              {...field("website")}
            />
          </Field>
          <Field>
            <FieldLabel htmlFor="organization-location">Location</FieldLabel>
            <Input {...field("location")} />
          </Field>
          <Field>
            <FieldLabel htmlFor="organization-email">Public email</FieldLabel>
            <Input type="email" {...field("email")} />
          </Field>
        </div>
      </FieldGroup>
    </SettingCard>
  );
}

/** What members may do: their standing access to every repository, what they may create, and whether private work may be forked. */
export function OrganizationPrivileges({
  slug,
  settings,
}: {
  slug: string;
  settings: Settings;
}) {
  const { save, saving } = useSaveSettings(slug);
  const [policy, setPolicy] = useState({
    basePermission: settings.basePermission,
    membersCanCreatePublicRepositories:
      settings.membersCanCreatePublicRepositories,
    membersCanCreatePrivateRepositories:
      settings.membersCanCreatePrivateRepositories,
    allowPrivateForks: settings.allowPrivateForks,
    defaultBranch: settings.defaultBranch ?? "",
  });
  const changed =
    policy.basePermission !== settings.basePermission ||
    policy.membersCanCreatePublicRepositories !==
      settings.membersCanCreatePublicRepositories ||
    policy.membersCanCreatePrivateRepositories !==
      settings.membersCanCreatePrivateRepositories ||
    policy.allowPrivateForks !== settings.allowPrivateForks ||
    policy.defaultBranch !== (settings.defaultBranch ?? "");
  const toggle = (
    key:
      | "membersCanCreatePublicRepositories"
      | "membersCanCreatePrivateRepositories"
      | "allowPrivateForks",
    title: string,
    description: string,
  ) => (
    <Field orientation="horizontal">
      <FieldContent>
        <FieldTitle>{title}</FieldTitle>
        <FieldDescription>{description}</FieldDescription>
      </FieldContent>
      <Switch
        aria-label={title}
        checked={policy[key]}
        onCheckedChange={(checked) => setPolicy({ ...policy, [key]: checked })}
      />
    </Field>
  );

  return (
    <SettingCard
      title="Member privileges"
      hint="Admins and owners are never limited by these."
      onSubmit={() =>
        save(
          { ...policy, defaultBranch: policy.defaultBranch.trim() || null },
          "Member privileges saved",
        )
      }
      pending={saving}
      canSave={changed}
    >
      <FieldGroup>
        <Field orientation="horizontal">
          <FieldContent>
            <FieldTitle>Base permission</FieldTitle>
            <FieldDescription>
              Every member&apos;s access to every repository. Teams and
              collaborators can raise it; &ldquo;None&rdquo; leaves private
              repositories to them.
            </FieldDescription>
          </FieldContent>
          <RoleSelect<CollaboratorRole | typeof NONE>
            label="Base permission"
            roles={[NONE, ...collaboratorRoles]}
            labels={{ ...roleLabels, [NONE]: "None" }}
            value={policy.basePermission ?? NONE}
            onChange={(next) =>
              setPolicy({
                ...policy,
                basePermission: next === NONE ? null : next,
              })
            }
          />
        </Field>
        {toggle(
          "membersCanCreatePublicRepositories",
          "Members can create public repositories",
          "Otherwise only admins can.",
        )}
        {toggle(
          "membersCanCreatePrivateRepositories",
          "Members can create private repositories",
          "Otherwise only admins can.",
        )}
        {toggle(
          "allowPrivateForks",
          "Allow forking private repositories",
          "Anyone who can read one could then copy it outside the organization.",
        )}
        <Field>
          <FieldLabel htmlFor="organization-default-branch">
            Default branch for new repositories
          </FieldLabel>
          <Input
            id="organization-default-branch"
            placeholder="main"
            value={policy.defaultBranch}
            onChange={(event) =>
              setPolicy({ ...policy, defaultBranch: event.target.value })
            }
            className="max-w-xs"
          />
          <FieldDescription>
            A repository opens on it once a branch by that name is pushed.
          </FieldDescription>
        </Field>
      </FieldGroup>
    </SettingCard>
  );
}

const MAX_PINNED = 6;

/** Which repositories open the profile, in the order they are picked. */
export function PinnedRepositoriesSetting({
  slug,
  repositories,
  pinned,
}: {
  slug: string;
  repositories: string[];
  pinned: string[];
}) {
  const router = useRouter();
  const [picked, setPicked] = useState(pinned);
  const [saving, setSaving] = useState(false);
  const changed = picked.join("/") !== pinned.join("/");

  async function save() {
    setSaving(true);
    const { error } = await apiClient.PUT("/api/organizations/{slug}/pins", {
      params: { path: { slug } },
      body: { repositories: picked },
    });
    setSaving(false);
    if (error) return toast.error(apiErrorMessage(error));
    toast.success("Pinned repositories saved");
    router.refresh();
  }

  return (
    <SettingCard
      title="Pinned repositories"
      hint={`Up to ${MAX_PINNED}, shown first on the profile in the order picked. Private ones show to members only.`}
      onSubmit={save}
      pending={saving}
      canSave={changed}
    >
      {repositories.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          The organization has no repositories yet.
        </p>
      ) : (
        <ul className="grid gap-2 sm:grid-cols-2">
          {repositories.map((repository) => {
            const position = picked.indexOf(repository);
            return (
              <li key={repository}>
                <Field orientation="horizontal">
                  <Checkbox
                    id={`pin-${repository}`}
                    checked={position >= 0}
                    disabled={position < 0 && picked.length >= MAX_PINNED}
                    onCheckedChange={(checked) =>
                      setPicked(
                        checked
                          ? [...picked, repository]
                          : picked.filter((name) => name !== repository),
                      )
                    }
                  />
                  <FieldLabel
                    htmlFor={`pin-${repository}`}
                    className="font-normal"
                  >
                    {repository}
                    {position >= 0 && (
                      <span className="text-muted-foreground">
                        #{position + 1}
                      </span>
                    )}
                  </FieldLabel>
                </Field>
              </li>
            );
          })}
        </ul>
      )}
    </SettingCard>
  );
}
