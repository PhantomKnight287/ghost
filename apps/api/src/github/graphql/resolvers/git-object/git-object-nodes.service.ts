import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import DataLoader from 'dataloader';

import { readSignedCommits } from '../../../../lib/git/commits/commit-signature.js';
import {
  type Commit,
  readCommitsBySha,
} from '../../../../lib/git/commits/list-commits.js';
import {
  listRefEntries,
  type RefEntry,
} from '../../../../lib/git/refs/list-refs.js';
import {
  readTagObjects,
  type TagObject,
} from '../../../../lib/git/tags/read-tag.js';
import { orNull } from '../../../../lib/github/authorize.js';
import { CouldNotResolveError } from '../../../../lib/github/github.errors.js';
import type { GraphqlContext } from '../../../../lib/github/loaders.js';
import { encodeNodeId } from '../../../../lib/github/node-id.js';
import {
  toCommitNode,
  toRefNode,
  toUserNode,
} from '../../../../lib/github/nodes.js';
import { githubOrigins } from '../../../../lib/github/origins.js';
import { RepositoryMaterializerService } from '../../../../services/git/materializer/repository-materializer.service.js';
import { CommitVerificationService } from '../../../../services/gpg/commit-verification.service.js';
import { sliceConnection } from '../../connection.js';
import {
  GitSignatureState,
  OrderDirection,
  RefOrderField,
} from '../../enums.js';
import type { RefOrder } from '../../inputs.js';
import {
  GpgSignatureNode,
  SshSignatureNode,
  TagNode,
} from '../../types/git-object.type.js';
import type { CommitNode } from '../../types/pull-request.type.js';
import type { RefNode, RepositoryNode } from '../../types/repository.type.js';
import { RepositoryNodesService } from '../repository/repository-nodes.service.js';

type Prefix = 'refs/heads/' | 'refs/tags/';
const PREFIXES: Prefix[] = ['refs/heads/', 'refs/tags/'];

/** Keyed `<repository ghost id>\0<sha or prefix>`, so one loader serves every repository a query touches. */
const key = (repositoryGhostId: string, rest: string) =>
  `${repositoryGhostId}\0${rest}`;

/** Refs, tags and commit signatures read from git for GraphQL, batched per request: a page of refs costs one git process per kind of object, not one per ref. */
@Injectable()
export class GitObjectNodesService {
  private readonly batches = new WeakMap<GraphqlContext, Batches>();

  constructor(
    private readonly materializer: RepositoryMaterializerService,
    private readonly verification: CommitVerificationService,
    private readonly repositoryNodes: RepositoryNodesService,
    private readonly config: ConfigService,
  ) {}

  /** `refs/heads/x` and `refs/tags/x` as given; a bare name is a branch first, then a tag, as on GitHub. */
  async ref(
    repository: RepositoryNode,
    qualifiedName: string,
    context: GraphqlContext,
  ) {
    const candidates = qualifiedName.startsWith('refs/')
      ? [qualifiedName]
      : PREFIXES.map((prefix) => `${prefix}${qualifiedName}`);
    for (const candidate of candidates) {
      const prefix = PREFIXES.find((each) => candidate.startsWith(each));
      if (!prefix) continue;
      const name = candidate.slice(prefix.length);
      const entries = await this.of(context).refs.load(
        key(repository.ghostId, prefix),
      );
      if (entries.some((entry) => entry.name === name))
        return toRefNode(repository.ghostId, name, prefix);
    }
    return null;
  }

  /** Null for a prefix other than branches or tags, which Ghost does not list. */
  async refs(
    repository: RepositoryNode,
    {
      refPrefix,
      query,
      orderBy,
      first,
      last,
      after,
    }: {
      refPrefix: string;
      query?: string | null;
      orderBy?: RefOrder | null;
      first?: number | null;
      last?: number | null;
      after?: string | null;
    },
    context: GraphqlContext,
  ) {
    const prefix = PREFIXES.find((each) => each === refPrefix);
    if (!prefix) return null;

    const entries = (
      await this.of(context).refs.load(key(repository.ghostId, prefix))
    ).filter((entry) => !query || entry.name.includes(query));
    const byDate = orderBy?.field === RefOrderField.TAG_COMMIT_DATE;
    entries.sort((a, b) =>
      byDate
        ? a.commitDate - b.commitDate || compare(a.name, b.name)
        : compare(a.name, b.name),
    );
    if (orderBy?.direction === OrderDirection.DESC) entries.reverse();

    return sliceConnection(
      entries.map((entry) => toRefNode(repository.ghostId, entry.name, prefix)),
      // GraphQL arguments skip the ValidationPipe, so the page size is capped here as GitHub caps it.
      {
        first: first == null ? null : Math.min(first, 100),
        last: last == null ? null : Math.min(last, 100),
        after,
      },
    );
  }

  /** A branch's commit, or an annotated tag's own object; a lightweight tag is its commit, as on GitHub. */
  async refTarget(ref: RefNode, context: GraphqlContext) {
    const batches = this.of(context);
    // A pull request's head may live in a fork the viewer cannot read; its ref then has no target, as on GitHub.
    if (!(await batches.repositories.load(ref.repositoryGhostId))) return null;
    const entry = (
      await batches.refs.load(key(ref.repositoryGhostId, ref.prefix as Prefix))
    ).find((each) => each.name === ref.name);
    if (!entry) return null;
    if (entry.type === 'tag')
      return this.tag(
        ref.repositoryGhostId,
        entry.oid,
        entry.peeledOid,
        context,
      );
    if (entry.type === 'commit')
      return this.commit(ref.repositoryGhostId, entry.oid, context);
    return null;
  }

  /** What a tag object names: a commit, or another tag. */
  async tagTarget(tag: TagNode, context: GraphqlContext) {
    return tag.targetType === 'tag'
      ? this.tag(tag.repositoryGhostId, tag.targetOid, tag.commitOid, context)
      : this.commit(tag.repositoryGhostId, tag.targetOid, context);
  }

  async commit(
    repositoryGhostId: string,
    sha: string,
    context: GraphqlContext,
  ): Promise<CommitNode | null> {
    const batches = this.of(context);
    const [commit, repository] = await Promise.all([
      batches.commits.load(key(repositoryGhostId, sha)),
      batches.repositories.load(repositoryGhostId),
    ]);
    return commit && repository && toCommitNode(commit, repository);
  }

  /** The commit a ref resolves to through any annotation. */
  async refCommit(ref: RefNode, context: GraphqlContext) {
    const batches = this.of(context);
    if (!(await batches.repositories.load(ref.repositoryGhostId))) return null;
    const entry = (
      await batches.refs.load(key(ref.repositoryGhostId, ref.prefix as Prefix))
    ).find((each) => each.name === ref.name);
    if (!entry) return null;
    return this.commit(
      ref.repositoryGhostId,
      entry.peeledOid ?? entry.oid,
      context,
    );
  }

  repository(repositoryGhostId: string, context: GraphqlContext) {
    return this.of(context).repositories.load(repositoryGhostId);
  }

  signature(commit: CommitNode, context: GraphqlContext) {
    return this.of(context).signatures.load({
      repositoryGhostId: commit.repositoryGhostId,
      sha: commit.oid,
      email: commit.author?.email ?? '',
    });
  }

  private async tag(
    repositoryGhostId: string,
    sha: string,
    commitOid: string | null,
    context: GraphqlContext,
  ) {
    const batches = this.of(context);
    const [tag, repository] = await Promise.all([
      batches.tags.load(key(repositoryGhostId, sha)),
      batches.repositories.load(repositoryGhostId),
    ]);
    if (!tag || !repository) return null;
    const commit = commitOid ?? tag.target.sha;
    return Object.assign(new TagNode(), {
      repositoryGhostId,
      targetOid: tag.target.sha,
      targetType: tag.target.type,
      commitOid: commit,
      id: encodeNodeId('Tag', `${repositoryGhostId}:${tag.sha}`),
      oid: tag.sha,
      abbreviatedOid: tag.sha.slice(0, 7),
      name: tag.name,
      message: tag.message,
      tagger: tag.tagger && { name: tag.tagger.name, email: tag.tagger.email },
      commitUrl: `${repository.url}/commit/${commit}`,
      commitResourcePath: `${repository.resourcePath}/commit/${commit}`,
    });
  }

  /** One set of loaders per GraphQL request, like `createLoaders`, but over git: nothing is cached across viewers. */
  private of(context: GraphqlContext): Batches {
    let batches = this.batches.get(context);
    if (batches) return batches;

    const viewer = context.req.githubViewer;
    const repositories = new DataLoader<string, RepositoryNode | null>((ids) =>
      Promise.all(
        ids.map((id) => orNull(this.repositoryNodes.load(id, viewer))),
      ),
    );
    const gitDirs = new DataLoader<string, string>((ids) =>
      Promise.all(
        ids.map(async (id) => {
          const repository = await repositories.load(id);
          if (!repository)
            throw new CouldNotResolveError('Repository not found');
          return this.materializer.open({
            id,
            defaultBranch: repository.defaultBranch,
          });
        }),
      ),
    );
    /** Groups `<repository>\0<rest>` keys by repository and answers each group with one call. */
    const perRepository =
      <T>(read: (gitDir: string, rests: string[]) => Promise<Map<string, T>>) =>
      async (keys: readonly string[]) => {
        const groups = groupBy(keys, (each) => each.split('\0')[0]);
        const found = new Map<string, T>();
        for (const [id, group] of groups) {
          const gitDir = await gitDirs.load(id);
          const rests = group.map((each) => each.split('\0')[1]);
          for (const [rest, value] of await read(gitDir, rests))
            found.set(key(id, rest), value);
        }
        return keys.map((each) => found.get(each) ?? null);
      };

    batches = {
      repositories,
      refs: new DataLoader<string, RefEntry[]>(async (keys) =>
        Promise.all(
          keys.map(async (each) => {
            const [id, prefix] = each.split('\0');
            const entries = await listRefEntries(
              await gitDirs.load(id),
              prefix as Prefix,
            );
            // Ghost browses commits only; a tag of a tree or blob has no target it can serve.
            return entries.filter(
              (entry) => (entry.peeledType ?? entry.type) === 'commit',
            );
          }),
        ),
      ),
      commits: new DataLoader<string, Commit | null>(
        perRepository((gitDir, shas) => readCommitsBySha({ gitDir, shas })),
      ),
      tags: new DataLoader<string, TagObject | null>(
        perRepository((gitDir, shas) => readTagObjects({ gitDir, shas })),
      ),
      signatures: new DataLoader<
        SignatureKey,
        GpgSignatureNode | SshSignatureNode | null,
        string
      >((wanted) => this.signatures(wanted, gitDirs, context), {
        cacheKeyFn: ({ repositoryGhostId, sha }) => key(repositoryGhostId, sha),
      }),
    };
    this.batches.set(context, batches);
    return batches;
  }

  private async signatures(
    wanted: readonly SignatureKey[],
    gitDirs: DataLoader<string, string>,
    context: GraphqlContext,
  ) {
    const found = new Map<string, GpgSignatureNode | SshSignatureNode>();
    for (const [id, group] of groupBy(
      wanted,
      (each) => each.repositoryGhostId,
    )) {
      const gitDir = await gitDirs.load(id);
      const signed = await readSignedCommits({
        gitDir,
        shas: group.map((each) => each.sha),
      });
      const commits = group.map(({ sha, email }) => ({
        sha,
        authorEmail: email,
      }));
      const verdicts = await this.verification.verifySigned({
        signed,
        commits,
      });
      for (const { sha, email } of group) {
        const object = signed.get(sha);
        const verdict = verdicts.get(sha);
        if (!object || !verdict) continue;
        const signer = verdict.signerId
          ? await context.loaders.usersById.load(verdict.signerId)
          : null;
        const fields = {
          email,
          isValid: verdict.state === 'valid',
          payload: object.payload,
          signature: object.signature,
          signer: signer && toUserNode(signer, githubOrigins(this.config)),
          state: verdict.state.toUpperCase() as GitSignatureState,
          verifiedAt: null,
          // A platform key is the only valid verdict that names no account; on Ghost, Ghost's own key stands where GitHub's does on github.com.
          wasSignedByGitHub: verdict.verified && verdict.signerId === null,
        };
        found.set(
          key(id, sha),
          object.format === 'ssh'
            ? Object.assign(new SshSignatureNode(), fields, {
                keyFingerprint: verdict.keyId,
              })
            : Object.assign(new GpgSignatureNode(), fields, {
                keyId: verdict.keyId === 'unknown' ? null : verdict.keyId,
              }),
        );
      }
    }
    return wanted.map(
      ({ repositoryGhostId, sha }) =>
        found.get(key(repositoryGhostId, sha)) ?? null,
    );
  }
}

const compare = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);

// ponytail: Map.groupBy once the compile target reaches ES2024.
function groupBy<T>(items: readonly T[], by: (item: T) => string) {
  const groups = new Map<string, T[]>();
  for (const item of items) {
    const group = groups.get(by(item));
    if (group) group.push(item);
    else groups.set(by(item), [item]);
  }
  return groups;
}

interface SignatureKey {
  repositoryGhostId: string;
  sha: string;
  email: string;
}

interface Batches {
  repositories: DataLoader<string, RepositoryNode | null>;
  refs: DataLoader<string, RefEntry[]>;
  commits: DataLoader<string, Commit | null>;
  tags: DataLoader<string, TagObject | null>;
  signatures: DataLoader<
    SignatureKey,
    GpgSignatureNode | SshSignatureNode | null,
    string
  >;
}
