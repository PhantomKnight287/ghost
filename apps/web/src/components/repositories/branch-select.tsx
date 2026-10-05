"use client";

import { useVirtualizer } from "@tanstack/react-virtual";
import { useMemo, useState } from "react";

import { Button } from "@/components/ui/button";
import {
  Combobox,
  ComboboxContent,
  ComboboxEmpty,
  ComboboxInput,
  ComboboxItem,
  ComboboxList,
  ComboboxTrigger,
  ComboboxValue,
} from "@/components/ui/combobox";
import { cn } from "@/lib/utils";

const ROW_HEIGHT = 32;

/** A branch picker that stays fast with thousands of branches: the list is searched, and only the rows in view are rendered. */
export function BranchSelect({
  branches,
  value,
  onValueChange,
  placeholder = "Select a branch",
  id,
  className,
}: {
  branches: string[];
  value: string;
  onValueChange: (branch: string) => void;
  placeholder?: string;
  id?: string;
  className?: string;
}) {
  const [query, setQuery] = useState("");
  const [list, setList] = useState<HTMLDivElement | null>(null);

  const matches = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return needle
      ? branches.filter((branch) => branch.toLowerCase().includes(needle))
      : branches;
  }, [branches, query]);

  const virtualizer = useVirtualizer({
    count: matches.length,
    getScrollElement: () => list,
    estimateSize: () => ROW_HEIGHT,
    overscan: 10,
  });

  return (
    <Combobox
      items={matches}
      // filtered above, so the virtualizer and the list agree on every index
      filter={null}
      virtualized
      value={value || null}
      onValueChange={(branch: string | null) => {
        if (branch) onValueChange(branch);
      }}
      inputValue={query}
      onInputValueChange={setQuery}
      onItemHighlighted={(_, { reason, index }) => {
        if (reason === "keyboard") virtualizer.scrollToIndex(index);
      }}
    >
      <ComboboxTrigger
        id={id}
        render={
          <Button
            variant="outline"
            className={cn("justify-between font-normal", className)}
          />
        }
      >
        <span className="truncate">
          <ComboboxValue placeholder={placeholder} />
        </span>
      </ComboboxTrigger>
      <ComboboxContent className="min-w-64">
        <ComboboxInput placeholder="Find a branch" showTrigger={false} />
        <ComboboxEmpty>No branch matches</ComboboxEmpty>
        <ComboboxList ref={setList}>
          {matches.length > 0 && (
            <div
              role="presentation"
              className="relative w-full"
              style={{ height: virtualizer.getTotalSize() }}
            >
              {virtualizer.getVirtualItems().map((row) => (
                <ComboboxItem
                  key={row.key}
                  index={row.index}
                  value={matches[row.index]}
                  aria-setsize={matches.length}
                  aria-posinset={row.index + 1}
                  className="absolute top-0 left-0"
                  style={{
                    height: row.size,
                    transform: `translateY(${row.start}px)`,
                  }}
                >
                  <span className="truncate">{matches[row.index]}</span>
                </ComboboxItem>
              ))}
            </div>
          )}
        </ComboboxList>
      </ComboboxContent>
    </Combobox>
  );
}
