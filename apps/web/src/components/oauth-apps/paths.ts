/** Where an organization's OAuth app settings live, or the signed-in user's when there is no organization. */
export function oauthAppsPath(organization?: string) {
  return organization
    ? `/${organization}/settings/oauth-apps`
    : "/settings/oauth-apps";
}
