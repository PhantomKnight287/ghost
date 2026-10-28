import { CouldNotResolveError } from './github.errors.js';

const PREFIXES = {
  User: 'U',
  Organization: 'O',
  Team: 'T',
  Repository: 'R',
  Issue: 'I',
  PullRequest: 'PR',
  PullRequestReview: 'PRR',
  PullRequestReviewComment: 'PRRC',
  PullRequestReviewThread: 'PRRT',
  PullRequestCommit: 'PURC',
  ReviewRequest: 'RR',
  Commit: 'C',
  IssueComment: 'IC',
  Label: 'LA',
  Release: 'RE',
  ReleaseAsset: 'RA',
  StatusContext: 'SC',
  StatusCheckRollup: 'SCR',
  RepositoryRuleset: 'RRS',
  RepositoryRule: 'RRU',
  RepositoryRulesetBypassActor: 'RBA',
  Bot: 'BOT',
  App: 'APP',
} as const;

export type NodeType = keyof typeof PREFIXES;

const TYPES = new Map(
  Object.entries(PREFIXES).map(([type, prefix]) => [prefix, type as NodeType]),
);

/** GitHub-style global id: the type's GitHub prefix, then the Ghost id in base64url. Opaque to clients, which only hand it back. */
export function encodeNodeId(type: NodeType, id: string) {
  return `${PREFIXES[type]}_${Buffer.from(id).toString('base64url')}`;
}

export function decodeNodeId(
  nodeId: string,
): { type: NodeType; id: string } | null {
  const separator = nodeId.indexOf('_');
  if (separator < 1) return null;
  const type = TYPES.get(
    nodeId.slice(0, separator) as Parameters<typeof TYPES.get>[0],
  );
  const id = Buffer.from(nodeId.slice(separator + 1), 'base64url').toString(
    'utf8',
  );
  return type && id ? { type, id } : null;
}

/** The Ghost id behind a node id of one of `types`; any other id fails as GitHub fails an unresolvable node. */
export function decodeNodeIdAs(nodeId: string, ...types: NodeType[]) {
  const decoded = decodeNodeId(nodeId);
  if (!decoded || !types.includes(decoded.type))
    throw new CouldNotResolveError(
      `Could not resolve to a node with the global id of '${nodeId}'`,
    );
  return decoded.id;
}
