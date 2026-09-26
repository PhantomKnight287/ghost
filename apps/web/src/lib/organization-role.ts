import type { OrganizationRole } from "@ghost/permissions";

export const organizationRoleLabels: Record<OrganizationRole, string> = {
  member: "Member",
  admin: "Admin",
  owner: "Owner",
};
