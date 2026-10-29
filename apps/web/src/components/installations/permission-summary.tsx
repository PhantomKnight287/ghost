import { PERMISSIONS } from "@/components/apps/permissions";
import type { components } from "@/lib/api/v1";

/** What an installation of the app may do, in the words the registration form uses. Metadata is always read and goes unsaid. */
export function PermissionSummary({
  permissions,
}: {
  permissions: components["schemas"]["InstallationDTO"]["permissions"];
}) {
  const granted = PERMISSIONS.filter(({ name }) => permissions[name]);
  if (granted.length === 0)
    return (
      <p className="text-sm text-muted-foreground">
        Read-only access to repository metadata.
      </p>
    );
  return (
    <ul className="flex flex-col gap-2 text-sm">
      {granted.map(({ name, label, detail }) => (
        <li key={name} className="flex flex-col">
          <span className="font-medium">
            {label}
            <span className="ml-2 font-normal text-muted-foreground">
              {permissions[name] === "write" ? "Read and write" : "Read"}
            </span>
          </span>
          <span className="text-muted-foreground">{detail}</span>
        </li>
      ))}
    </ul>
  );
}
