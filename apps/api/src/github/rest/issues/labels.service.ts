import { Injectable } from '@nestjs/common';

import { GithubNotFoundError } from '../../../lib/github/github.errors.js';
import { labelNamesOf, pageOf, RestPage } from '../../../lib/github/rest.js';
import type { LabelDTO } from '../../../resources/issues/dto/label.dto.js';
import { IssuesService } from '../../../resources/issues/issues.service.js';
import type { GithubRepositoryTarget } from '../../auth/github-request.js';
import type { RepositoryNode } from '../../graphql/types/repository.type.js';
import type { GithubPageQueryDTO } from './dto/issue.dto.js';
import type {
  GithubCreateLabelDTO,
  GithubUpdateLabelDTO,
} from './dto/label.dto.js';
import { GithubIssuesService } from './issues.service.js';

/** GitHub's REST labels, of a repository and of an issue, over IssuesService. */
@Injectable()
export class GithubLabelsService {
  constructor(
    private readonly github: GithubIssuesService,
    private readonly issues: IssuesService,
  ) {}

  async list(
    { owner, repo, viewer }: GithubRepositoryTarget,
    query: GithubPageQueryDTO,
  ) {
    const repository = await this.github.readable(owner, repo, viewer);
    const { labels } = await this.issues.listLabels(
      this.github.ref(repository, viewer),
    );
    return this.page(repository, labels, query);
  }

  async create(
    { owner, repo, viewer }: GithubRepositoryTarget,
    body: GithubCreateLabelDTO,
  ) {
    const { repository, viewer: signedIn } = await this.github.writable(
      owner,
      repo,
      viewer,
      'POST /repos/:owner/:repo/labels',
    );
    const created = await this.issues.createLabel({
      ...this.github.ref(repository, signedIn),
      requesterId: signedIn.userId,
      body: {
        name: body.name,
        color: body.color ?? 'ededed',
        description: body.description,
      },
    });
    const [label] = await this.github.labels(repository, [created]);
    return label;
  }

  async get({ owner, repo, viewer }: GithubRepositoryTarget, name: string) {
    const repository = await this.github.readable(owner, repo, viewer);
    const label = await this.github.labelByName(repository, viewer, name);
    const [rest] = await this.github.labels(repository, [label]);
    return rest;
  }

  async update(
    { owner, repo, viewer }: GithubRepositoryTarget,
    name: string,
    body: GithubUpdateLabelDTO,
  ) {
    const { repository, viewer: signedIn } = await this.github.writable(
      owner,
      repo,
      viewer,
      'PATCH /repos/:owner/:repo/labels/:name',
    );
    const label = await this.github.labelByName(repository, signedIn, name);
    const updated = await this.issues.updateLabel({
      ...this.github.ref(repository, signedIn),
      requesterId: signedIn.userId,
      labelId: label.id,
      body: {
        name: body.new_name,
        color: body.color,
        description: body.description,
      },
    });
    const [rest] = await this.github.labels(repository, [updated]);
    return rest;
  }

  async delete({ owner, repo, viewer }: GithubRepositoryTarget, name: string) {
    const { repository, viewer: signedIn } = await this.github.writable(
      owner,
      repo,
      viewer,
      'DELETE /repos/:owner/:repo/labels/:name',
    );
    const label = await this.github.labelByName(repository, signedIn, name);
    await this.issues.deleteLabel({
      ...this.github.ref(repository, signedIn),
      requesterId: signedIn.userId,
      labelId: label.id,
    });
  }

  async listOnIssue(
    { owner, repo, viewer }: GithubRepositoryTarget,
    number: number,
    query: GithubPageQueryDTO,
  ) {
    const repository = await this.github.readable(owner, repo, viewer);
    const issue = await this.issues.getIssue({
      ...this.github.ref(repository, viewer),
      number,
    });
    return this.page(repository, issue.labels, query);
  }

  /** `body` is any shape GitHub accepts for a list of labels; answers all of the issue's labels. */
  addToIssue(target: GithubRepositoryTarget, number: number, body: unknown) {
    const names = labelNamesOf(body);
    return this.change(
      target,
      number,
      'POST /repos/:owner/:repo/issues/:number/labels',
      names,
      (current) => [...current, ...names],
    );
  }

  setOnIssue(target: GithubRepositoryTarget, number: number, body: unknown) {
    const names = labelNamesOf(body);
    return this.change(
      target,
      number,
      'PUT /repos/:owner/:repo/issues/:number/labels',
      names,
      () => names,
    );
  }

  async clearOnIssue(target: GithubRepositoryTarget, number: number) {
    await this.change(
      target,
      number,
      'DELETE /repos/:owner/:repo/issues/:number/labels',
      [],
      () => [],
    );
  }

  /** Answers the labels left; 404 when the issue does not have the label. */
  removeFromIssue(
    target: GithubRepositoryTarget,
    number: number,
    name: string,
  ) {
    return this.change(
      target,
      number,
      'DELETE /repos/:owner/:repo/issues/:number/labels/:name',
      [],
      (current) => {
        const left = current.filter(
          (label) => label.toLowerCase() !== name.toLowerCase(),
        );
        if (left.length === current.length) throw new GithubNotFoundError();
        return left;
      },
    );
  }

  /** Every label write is a read, then a full replacement through IssuesService, creating the labels it names that do not exist yet. */
  private async change(
    { owner, repo, viewer }: GithubRepositoryTarget,
    number: number,
    route: string,
    added: string[],
    next: (current: string[]) => string[],
  ) {
    const { repository, viewer: signedIn } = await this.github.writable(
      owner,
      repo,
      viewer,
      route,
    );
    const ref = {
      ...this.github.ref(repository, signedIn),
      number,
      requesterId: signedIn.userId,
    };
    const issue = await this.issues.getIssue(ref);
    if (!this.github.canTriage(repository))
      return this.github.labels(repository, issue.labels);
    await this.github.ensureLabels(repository, signedIn, added);
    // ponytail: read then replace; two concurrent adds can lose one. Add IssuesService.addIssueLabels if that bites.
    const { labels } = await this.issues.setIssueLabels({
      ...ref,
      names: next(issue.labels.map((label) => label.name)),
    });
    return this.github.labels(repository, labels);
  }

  // ponytail: labels are listed whole by IssuesService and sliced here; a repository with thousands of labels would want paging in the query.
  private async page(
    repository: RepositoryNode,
    labels: LabelDTO[],
    query: GithubPageQueryDTO,
  ) {
    const page = pageOf(query);
    return new RestPage(
      await this.github.labels(
        repository,
        labels.slice(page.offset, page.offset + page.perPage),
      ),
      page,
      labels.length,
    );
  }
}
