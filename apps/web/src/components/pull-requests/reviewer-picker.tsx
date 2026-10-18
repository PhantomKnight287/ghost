"use client";

import { ProfileAvatar } from "@/components/users/profile-avatar";
import { useDebouncedValue } from "@tanstack/react-pacer";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { Users } from "lucide-react";
import { Fragment, useState } from "react";

import {
  Combobox,
  ComboboxChip,
  ComboboxChips,
  ComboboxChipsInput,
  ComboboxContent,
  ComboboxEmpty,
  ComboboxItem,
  ComboboxList,
  ComboboxValue,
  useComboboxAnchor,
} from "@/components/ui/combobox";
import { apiClient } from "@/lib/api/client";
import { suggestUsers } from "@/lib/suggestions";

const MAX_REVIEWERS = 15;

/** Picks up to fifteen reviewers: people by username, and the owning organization's teams, written `org/team` as GitHub does. Opened empty, it offers the people involved in the repository. */
export function ReviewerPicker({
  username,
  repo,
  author,
  value,
  onChange,
  disabled = false,
}: {
  username: string;
  repo: string;
  /** Never requestable, so never offered. */
  author: string;
  value: string[];
  onChange: (reviewers: string[]) => void;
  disabled?: boolean;
}) {
  const anchor = useComboboxAnchor();
  const [query, setQuery] = useState("");
  const [search] = useDebouncedValue(query.trim(), { wait: 200 });

  const { data: users = [], isFetching } = useQuery({
    queryKey: ["assignee-suggestions", username, repo, search],
    placeholderData: keepPreviousData,
    staleTime: 30_000,
    queryFn: () => suggestUsers({ username, repo }, search),
  });
  const { data: teams = [] } = useQuery({
    queryKey: ["organization-teams", username],
    staleTime: 30_000,
    // A personal repository has no teams and only members may list an organization's, so a refusal means none to offer.
    queryFn: async () =>
      (
        await apiClient.GET("/api/organizations/{slug}/teams", {
          params: { path: { slug: username } },
        })
      ).data?.teams ?? [],
  });
  const byName = new Map(users.map((user) => [user.username, user]));
  const items = [
    ...teams
      .filter((team) => team.slug.includes(search.toLowerCase()))
      .map((team) => `${username}/${team.slug}`),
    ...users.map((user) => user.username).filter((name) => name !== author),
  ];

  return (
    <Combobox
      multiple
      items={items}
      // the API matched users already, and teams are matched above
      filter={null}
      value={value}
      onValueChange={(next: string[]) => onChange(next.slice(0, MAX_REVIEWERS))}
      inputValue={query}
      onInputValueChange={setQuery}
      disabled={disabled}
    >
      <ComboboxChips ref={anchor} className="w-full">
        <ComboboxValue>
          {(selected: string[]) => (
            <Fragment>
              {selected.map((name) => (
                <ComboboxChip key={name}>{name}</ComboboxChip>
              ))}
              <ComboboxChipsInput
                placeholder={selected.length ? "" : "Search people and teams"}
              />
            </Fragment>
          )}
        </ComboboxValue>
      </ComboboxChips>
      <ComboboxContent anchor={anchor}>
        <ComboboxEmpty>
          {isFetching ? "Searching…" : "No one by that name."}
        </ComboboxEmpty>
        <ComboboxList>
          {(name: string) => (
            <ComboboxItem key={name} value={name}>
              {name.includes("/") ? (
                <Users className="size-5 text-muted-foreground" />
              ) : (
                <ProfileAvatar
                  name={name}
                  image={byName.get(name)?.image}
                  className="size-5"
                  fallbackClassName="text-[10px]"
                />
              )}
              <span className="font-medium">{name}</span>
              <span className="truncate text-muted-foreground">
                {byName.get(name)?.name}
              </span>
            </ComboboxItem>
          )}
        </ComboboxList>
      </ComboboxContent>
    </Combobox>
  );
}
