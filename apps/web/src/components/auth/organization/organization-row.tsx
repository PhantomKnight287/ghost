"use client";

import { useAuthPlugin } from "@better-auth-ui/react";
import type { Organization } from "better-auth/client";
import { Settings as SettingsIcon } from "lucide-react";
import Link from "next/link";

import { Button } from "@/components/ui/button";
import { Item, ItemActions } from "@/components/ui/item";
import { organizationPlugin } from "@/lib/auth/organization-plugin";
import { OrganizationView } from "./organization-view";

export type OrganizationRowProps = {
  organization: Organization;
};

/** Single organization row: logo and labels via `OrganizationView`, plus a Manage action. */
export function OrganizationRow({ organization }: OrganizationRowProps) {
  const { localization } = useAuthPlugin(organizationPlugin);

  return (
    <Item>
      <OrganizationView className="flex-1" organization={organization} />
      <ItemActions>
        <Button variant="outline" size="sm" asChild>
          <Link href={`/${organization.slug}/settings`}>
            <SettingsIcon />
            {localization.manage}
          </Link>
        </Button>
      </ItemActions>
    </Item>
  );
}
