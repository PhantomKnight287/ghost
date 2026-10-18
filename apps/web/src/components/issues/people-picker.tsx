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
import { suggestReviewers, suggestUsers } from "@/lib/suggestions";

/** Picks up to ten assignees by searching usernames. Opened empty, it offers the people involved in the repository, and the viewer can assign themselves in one click. Given a pull request, it picks up to fifteen of its requestable reviewers instead, teams written `org/team` as GitHub does. */
export function PeoplePicker({
  username,
  repo,
  pullRequest,
  value,
  onChange,
  viewer,
  id,
  disabled = false,
}: {
  username: string;
  repo: string;
  pullRequest?: number;
  value: string[];
  onChange: (people: string[]) => void;
  viewer?: string | null;
  id?: string;
  disabled?: boolean;
}) {
  const anchor = useComboboxAnchor();
  const [query, setQuery] = useState("");
  const [search] = useDebouncedValue(query.trim(), { wait: 200 });

  const max = pullRequest === undefined ? 10 : 15;

  const { data: { users, teams } = { users: [], teams: [] }, isFetching } =
    useQuery({
      queryKey: ["people-suggestions", username, repo, pullRequest, search],
      placeholderData: keepPreviousData,
      staleTime: 30_000,
      queryFn: async () =>
        pullRequest === undefined
          ? { users: await suggestUsers({ username, repo }, search), teams: [] }
          : suggestReviewers({ username, repo, number: pullRequest }, search),
    });
  const byName = new Map<string, { name: string | null; image: string | null }>(
    [
      ...teams.map(
        (team) =>
          [
            `${username}/${team.slug}`,
            { name: team.name, image: null },
          ] as const,
      ),
      ...users.map((user) => [user.username, user] as const),
    ],
  );

  return (
    <div className="flex flex-col gap-1.5">
      <Combobox
        multiple
        items={[...byName.keys()]}
        // the API matched already
        filter={null}
        value={value}
        onValueChange={(next: string[]) => onChange(next.slice(0, max))}
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
                  id={id}
                  placeholder={
                    selected.length
                      ? ""
                      : pullRequest === undefined
                        ? "Search by username"
                        : "Search people and teams"
                  }
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

      {viewer && !value.includes(viewer) && value.length < max && (
        <button
          type="button"
          className="w-fit text-xs text-muted-foreground hover:text-primary hover:underline disabled:opacity-50"
          disabled={disabled}
          onClick={() => onChange([...value, viewer])}
        >
          Assign yourself
        </button>
      )}
    </div>
  );
}
