import type { components } from "@/lib/api/v1";

export type ViewerRole = components["schemas"]["ViewerRole"];
export type CollaboratorRole = components["schemas"]["RepositoryRole"];

/** Lowest to highest, as the API ranks them. */
export const collaboratorRoles = [
  "read",
  "triage",
  "write",
  "maintain",
  "admin",
] as const satisfies readonly CollaboratorRole[];
const ladder: readonly ViewerRole[] = [...collaboratorRoles, "owner"];

/** Whether `role` includes everything `needed` may do. The API decides for real; this only hides controls that would be refused. */
export function atLeast(
  role: ViewerRole | null | undefined,
  needed: ViewerRole,
) {
  return role != null && ladder.indexOf(role) >= ladder.indexOf(needed);
}

export const roleDescriptions: Record<CollaboratorRole, string> = {
  read: "View and clone, open issues and comment.",
  triage: "Also close, label and assign issues and pull requests.",
  write: "Also push, merge, and edit anyone's issues and comments.",
  maintain: "Also change the name, description and default branch.",
  admin: "Full access, including visibility, collaborators and deletion.",
};
