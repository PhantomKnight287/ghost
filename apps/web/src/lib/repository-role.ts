import { roleHierarchy } from "@ghost/permissions";

import type { components } from "@/lib/api/v1";

export type ViewerRole = components["schemas"]["ViewerRole"];
export type CollaboratorRole = components["schemas"]["RepositoryRole"];

/** Lowest to highest, as the API ranks them. */
export const collaboratorRoles = roleHierarchy.filter(
  (role): role is CollaboratorRole => role !== "owner",
) as ["read", "triage", "write", "maintain", "admin"];

/** Names for the pickers, organization roles included. */
export const roleLabels: Record<ViewerRole, string> = {
  read: "Read",
  triage: "Triage",
  write: "Write",
  maintain: "Maintain",
  admin: "Admin",
  owner: "Owner",
};

export const roleDescriptions: Record<CollaboratorRole, string> = {
  read: "View and clone, open issues and comment.",
  triage: "Also close, label and assign issues and pull requests.",
  write: "Also push, merge, and edit anyone's issues and comments.",
  maintain: "Also change the name, description and default branch.",
  admin: "Full access, including visibility, collaborators and deletion.",
};
