/** gh's OAuth app, the same client id on every GitHub host. Plan 3 replaces this constant with a registry of apps users create. */
export const GH_CLI_APP = { clientId: '178c6fc778ccc68e1d6a', name: 'GitHub CLI' } as const;

export function oauthAppOf(clientId: string) {
  return clientId === GH_CLI_APP.clientId ? GH_CLI_APP : null;
}
