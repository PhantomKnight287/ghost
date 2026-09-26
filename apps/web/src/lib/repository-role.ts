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
