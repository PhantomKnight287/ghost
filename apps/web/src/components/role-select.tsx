"use client";

import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { roleLabels } from "@/lib/repository-role";

/** A pick from a role ladder, restricted to `roles`. Repository roles by default; pass `labels` for another ladder. */
export function RoleSelect<TRole extends string>({
  id,
  roles,
  labels = roleLabels as Record<TRole, string>,
  value,
  onChange,
  label,
  disabled,
}: {
  id?: string;
  roles: readonly TRole[];
  labels?: Record<TRole, string>;
  value: TRole;
  onChange: (role: TRole) => void;
  label?: string;
  disabled?: boolean;
}) {
  return (
    <Select
      value={value}
      disabled={disabled}
      onValueChange={(next) => onChange(next as TRole)}
    >
      <SelectTrigger id={id} aria-label={label} className="w-full sm:w-32">
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {roles.map((role) => (
          <SelectItem key={role} value={role}>
            {labels[role]}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
