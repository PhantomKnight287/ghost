"use client";

import { parseAsArrayOf, parseAsString, useQueryStates } from "nuqs";
import { Fragment, useTransition } from "react";

import { LabelBadge } from "@/components/issues/label-badge";
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

type Label = { name: string; color: string; description?: string | null };

/** Filters a list by any number of labels, kept in `?labels=a,b` so the server renders the matching page. A new selection starts again from the first page. */
export function LabelFilter({ labels }: { labels: Label[] }) {
  const anchor = useComboboxAnchor();
  const [pending, startTransition] = useTransition();
  const [{ labels: selected }, setFilter] = useQueryStates(
    {
      labels: parseAsArrayOf(parseAsString, ",").withDefault([]),
      cursor: parseAsString,
    },
    { shallow: false, startTransition },
  );

  const byName = new Map(labels.map((label) => [label.name, label]));
  // A name left in the URL by a deleted label still needs a way out.
  for (const name of selected)
    if (!byName.has(name)) byName.set(name, { name, color: "9ca3af" });

  return (
    <Combobox
      multiple
      items={[...byName.keys()]}
      value={selected}
      onValueChange={(next: string[]) =>
        setFilter({ labels: next.length ? next : null, cursor: null })
      }
    >
      <ComboboxChips
        ref={anchor}
        className="min-w-56 flex-1"
        aria-busy={pending}
      >
        <ComboboxValue>
          {(names: string[]) => (
            <Fragment>
              {names.map((name) => (
                <ComboboxChip key={name}>{name}</ComboboxChip>
              ))}
              <ComboboxChipsInput
                aria-label="Filter by label"
                placeholder={names.length ? "" : "Filter by label"}
              />
            </Fragment>
          )}
        </ComboboxValue>
      </ComboboxChips>
      <ComboboxContent anchor={anchor}>
        <ComboboxEmpty>No label by that name.</ComboboxEmpty>
        <ComboboxList>
          {(name: string) => (
            <ComboboxItem key={name} value={name}>
              <LabelBadge label={byName.get(name)!} />
            </ComboboxItem>
          )}
        </ComboboxList>
      </ComboboxContent>
    </Combobox>
  );
}
