/** Everything an import brings in is authored by the importer account, so the GitHub author is credited in the text itself. */
export function attributed(login: string, action: string, body: string | null) {
  const credit = `_${action} by [@${login}](https://github.com/${login}) on GitHub._`;
  return body ? `${credit}\n\n${body}` : credit;
}
