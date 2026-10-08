"use client";

import type { ComponentProps } from "react";

import { cn } from "@/lib/utils";
import { Organizations } from "./organizations";
import { UserInvitations } from "./user-invitations";

export type OrganizationsSettingsProps = {
  className?: string;
};

export function OrganizationsSettings({
  className,
  ...props
}: OrganizationsSettingsProps & ComponentProps<"div">) {
  return (
    <div
      className={cn("flex w-full flex-col gap-4 md:gap-6", className)}
      {...props}
    >
      <Organizations />
      <UserInvitations />
    </div>
  );
}
