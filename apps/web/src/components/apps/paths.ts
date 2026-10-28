/** Where an organization's Ghost App settings live, or the signed-in user's when there is no organization. */
export function appsPath(organization?: string) {
  return organization ? `/${organization}/settings/apps` : "/settings/apps";
}
