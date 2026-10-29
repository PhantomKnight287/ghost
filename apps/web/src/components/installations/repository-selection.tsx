"use client";

import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";

export type Selection = {
  repositorySelection: "all" | "selected";
  repositoryIds: string[];
};

/** All of an account's repositories, or the ones ticked. */
export function RepositorySelection({
  repositories,
  value,
  onChange,
}: {
  repositories: { id: string; fullName: string }[];
  value: Selection;
  onChange: (value: Selection) => void;
}) {
  const toggle = (id: string, checked: boolean) =>
    onChange({
      ...value,
      repositoryIds: checked
        ? [...value.repositoryIds, id]
        : value.repositoryIds.filter((picked) => picked !== id),
    });

  return (
    <div className="flex flex-col gap-3">
      <RadioGroup
        value={value.repositorySelection}
        onValueChange={(repositorySelection) =>
          onChange({
            ...value,
            repositorySelection:
              repositorySelection as Selection["repositorySelection"],
          })
        }
      >
        <Label className="flex items-center gap-2 font-normal">
          <RadioGroupItem value="all" />
          All repositories, including ones created later
        </Label>
        <Label className="flex items-center gap-2 font-normal">
          <RadioGroupItem value="selected" />
          Only select repositories
        </Label>
      </RadioGroup>
      {value.repositorySelection === "selected" &&
        (repositories.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            This account has no repositories yet.
          </p>
        ) : (
          <ul className="flex max-h-64 flex-col gap-2 overflow-y-auto rounded-md border p-3">
            {repositories.map(({ id, fullName }) => (
              <li key={id}>
                <Label className="flex items-center gap-2 font-mono text-xs font-normal">
                  <Checkbox
                    checked={value.repositoryIds.includes(id)}
                    onCheckedChange={(checked) => toggle(id, checked === true)}
                  />
                  {fullName}
                </Label>
              </li>
            ))}
          </ul>
        ))}
    </div>
  );
}
