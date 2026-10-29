/** Where an organization's installed apps are managed, or the signed-in user's when there is no organization. */
export function installationsPath(organization?: string) {
  return organization
    ? `/${organization}/settings/installations`
    : "/settings/installations";
}
