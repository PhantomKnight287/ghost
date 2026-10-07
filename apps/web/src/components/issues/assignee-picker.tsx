"use client";

import { useDebouncedValue } from "@tanstack/react-pacer";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { Fragment, useState } from "react";

import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
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
import { suggestUsers } from "@/lib/suggestions";

const MAX_ASSIGNEES = 10;

/** Picks up to ten assignees by searching usernames. Opened empty, it offers the people involved in the repository, and the viewer can assign themselves in one click. */
export function AssigneePicker({
  username,
  repo,
  value,
  onChange,
  viewer,
  id,
  disabled = false,
}: {
  username: string;
  repo: string;
  value: string[];
  onChange: (assignees: string[]) => void;
  viewer?: string | null;
  id?: string;
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
  const byName = new Map(users.map((user) => [user.username, user]));

  return (
    <div className="flex flex-col gap-1.5">
      <Combobox
        multiple
        items={users.map((user) => user.username)}
        // the API matched already
        filter={null}
        value={value}
        onValueChange={(next: string[]) =>
          onChange(next.slice(0, MAX_ASSIGNEES))
        }
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
                  placeholder={selected.length ? "" : "Search by username"}
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
                <Avatar className="size-5">
                  {byName.get(name)?.image && (
                    <AvatarImage
                      src={byName.get(name)?.image ?? undefined}
                      alt=""
                    />
                  )}
                  <AvatarFallback className="text-[10px]">
                    {name.slice(0, 1).toUpperCase()}
                  </AvatarFallback>
                </Avatar>
                <span className="font-medium">{name}</span>
                <span className="truncate text-muted-foreground">
                  {byName.get(name)?.name}
                </span>
              </ComboboxItem>
            )}
          </ComboboxList>
        </ComboboxContent>
      </Combobox>

      {viewer && !value.includes(viewer) && value.length < MAX_ASSIGNEES && (
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
