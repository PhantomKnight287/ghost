const TOKEN = /(-?[\w-]+):("[^"]*"|\S+)|("[^"]*"|\S+)/g;

/** GitHub's issue search syntax, as far as Ghost's issue filters reach. Qualifiers Ghost cannot apply are dropped, as GitHub drops unknown ones. */
export function parseIssueSearch(query: string) {
  const result = {
    repo: null as { owner: string; name: string } | null,
    state: 'all' as 'open' | 'closed' | 'all',
    isPullRequest: null as boolean | null,
    author: undefined as string | undefined,
    assignee: undefined as string | undefined,
    labels: [] as string[],
    text: '',
  };
  const words: string[] = [];
  for (const [, key, rawValue, bare] of query.matchAll(TOKEN)) {
    if (bare) {
      words.push(bare.replace(/^"|"$/g, ''));
      continue;
    }
    const value = rawValue!.replace(/^"|"$/g, '');
    switch (key) {
      case 'repo': {
        const [owner, name] = value.split('/');
        if (owner && name) result.repo = { owner, name };
        break;
      }
      case 'is':
        if (value === 'open' || value === 'closed') result.state = value;
        if (value === 'issue') result.isPullRequest = false;
        if (value === 'pr') result.isPullRequest = true;
        break;
      case 'state':
        if (value === 'open' || value === 'closed') result.state = value;
        break;
      case 'type':
        if (value === 'issue') result.isPullRequest = false;
        if (value === 'pr') result.isPullRequest = true;
        break;
      case 'author':
        result.author = value;
        break;
      case 'assignee':
        result.assignee = value;
        break;
      case 'label':
        result.labels.push(value);
        break;
    }
  }
  result.text = words.join(' ');
  return result;
}
