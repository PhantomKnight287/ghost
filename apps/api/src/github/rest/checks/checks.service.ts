import type { Database } from '@ghost/db';
import { Inject, Injectable } from '@nestjs/common';

import { DATABASE } from '../../../database/database.module.js';
import { onCommit } from '../../../lib/github/on-commit.js';
import {
  checkIdOf,
  checkRunNumericIdsOf,
  checkSuiteNumericIdsOf,
} from '../../../lib/github/node-lookup.js';
import {
  pageOf,
  RestPage,
  toCheckAnnotationRest,
  toCheckRunRest,
  toCheckSuiteRest,
} from '../../../lib/github/rest.js';
import {
  type ChecksCaller,
  ChecksService,
} from '../../../resources/checks/checks.service.js';
import type {
  CheckRunDTO,
  CheckRunInput,
  CheckSuiteDTO,
} from '../../../resources/checks/dto/check.dto.js';
import type {
  GithubRepositoryTarget,
  GithubViewer,
} from '../../auth/github-request.js';
import type { RepositoryNode } from '../../graphql/types/repository.type.js';
import { GithubAppService } from '../app/app.service.js';
import type { GithubPageQueryDTO } from '../issues/dto/issue.dto.js';
import { GithubIssuesService } from '../issues/issues.service.js';
import type {
  GithubCheckRunsDTO,
  GithubCheckRunsQueryDTO,
  GithubCheckSuitesDTO,
  GithubCheckSuitesQueryDTO,
  GithubCreateCheckRunDTO,
  GithubUpdateCheckRunDTO,
} from './dto/check.dto.js';

/** GitHub's REST check runs and check suites over ChecksService: its rows plus the integer ids, app objects and URLs GitHub's shapes embed. */
@Injectable()
export class GithubChecksService {
  constructor(
    @Inject(DATABASE) private readonly db: Database,
    private readonly github: GithubIssuesService,
    private readonly checks: ChecksService,
    private readonly apps: GithubAppService,
  ) {}

  async createRun(
    { owner, repo, viewer }: GithubRepositoryTarget,
    body: GithubCreateCheckRunDTO,
  ) {
    const { repository, caller } = await this.writer(
      owner,
      repo,
      viewer,
      'POST /repos/:owner/:repo/check-runs',
    );
    const run = await this.checks.createRun(caller, {
      ...runInput(body),
      name: body.name,
      headSha: body.head_sha,
    });
    return (await this.runsRest(repository, [run]))[0]!;
  }

  async updateRun(
    { owner, repo, viewer }: GithubRepositoryTarget,
    id: string,
    body: GithubUpdateCheckRunDTO,
  ) {
    const { repository, caller } = await this.writer(
      owner,
      repo,
      viewer,
      'PATCH /repos/:owner/:repo/check-runs/:id',
    );
    const run = await this.checks.updateRun(
      caller,
      await checkIdOf(this.db, 'run', id),
      runInput(body),
    );
    return (await this.runsRest(repository, [run]))[0]!;
  }

  async getRun({ owner, repo, viewer }: GithubRepositoryTarget, id: string) {
    const repository = await this.github.readable(owner, repo, viewer);
    const run = await this.checks.getRun(
      this.github.ref(repository, viewer),
      await checkIdOf(this.db, 'run', id),
    );
    return (await this.runsRest(repository, [run]))[0]!;
  }

  async annotations(
    { owner, repo, viewer }: GithubRepositoryTarget,
    id: string,
    query: GithubPageQueryDTO,
  ) {
    const repository = await this.github.readable(owner, repo, viewer);
    const target = this.github.ref(repository, viewer);
    const runId = await checkIdOf(this.db, 'run', id);
    const page = pageOf(query);
    const [run, { annotations, total }, context] = await Promise.all([
      this.checks.getRun(target, runId),
      this.checks.annotations(target, runId, {
        offset: page.offset,
        limit: page.perPage,
      }),
      this.context(repository),
    ]);
    return new RestPage(
      annotations.map((annotation) =>
        toCheckAnnotationRest(annotation, run.headSha, context),
      ),
      page,
      total,
    );
  }

  async runsForRef(
    { owner, repo, viewer }: GithubRepositoryTarget,
    ref: string,
    query: GithubCheckRunsQueryDTO,
  ): Promise<GithubCheckRunsDTO> {
    const repository = await this.github.readable(owner, repo, viewer);
    const page = pageOf(query);
    const { runs, total } = await onCommit(
      ref,
      this.checks.runsForRef(this.github.ref(repository, viewer), ref, {
        ...runsQuery(query),
        offset: page.offset,
        limit: page.perPage,
      }),
    );
    return {
      total_count: total,
      check_runs: await this.runsRest(repository, runs),
    };
  }

  async runsOfSuite(
    { owner, repo, viewer }: GithubRepositoryTarget,
    id: string,
    query: GithubCheckRunsQueryDTO,
  ): Promise<GithubCheckRunsDTO> {
    const repository = await this.github.readable(owner, repo, viewer);
    const page = pageOf(query);
    const { runs, total } = await this.checks.runsOfSuite(
      this.github.ref(repository, viewer),
      await checkIdOf(this.db, 'suite', id),
      { ...runsQuery(query), offset: page.offset, limit: page.perPage },
    );
    return {
      total_count: total,
      check_runs: await this.runsRest(repository, runs),
    };
  }

  async rerequestRun(
    { owner, repo, viewer }: GithubRepositoryTarget,
    id: string,
  ) {
    const { caller } = await this.writer(
      owner,
      repo,
      viewer,
      'POST /repos/:owner/:repo/check-runs/:id/rerequest',
    );
    await this.checks.rerequestRun(caller, await checkIdOf(this.db, 'run', id));
    return {};
  }

  async createSuite(
    { owner, repo, viewer }: GithubRepositoryTarget,
    headSha: string,
  ) {
    const { repository, caller } = await this.writer(
      owner,
      repo,
      viewer,
      'POST /repos/:owner/:repo/check-suites',
    );
    const suite = await this.checks.createSuite(caller, headSha);
    return (await this.suitesRest(repository, [suite]))[0]!;
  }

  async getSuite({ owner, repo, viewer }: GithubRepositoryTarget, id: string) {
    const repository = await this.github.readable(owner, repo, viewer);
    const suite = await this.checks.getSuite(
      this.github.ref(repository, viewer),
      await checkIdOf(this.db, 'suite', id),
    );
    return (await this.suitesRest(repository, [suite]))[0]!;
  }

  async suitesForRef(
    { owner, repo, viewer }: GithubRepositoryTarget,
    ref: string,
    query: GithubCheckSuitesQueryDTO,
  ): Promise<GithubCheckSuitesDTO> {
    const repository = await this.github.readable(owner, repo, viewer);
    const page = pageOf(query);
    const { suites, total } = await onCommit(
      ref,
      this.checks.suitesForRef(this.github.ref(repository, viewer), ref, {
        appId: query.app_id,
        checkName: query.check_name,
        offset: page.offset,
        limit: page.perPage,
      }),
    );
    return {
      total_count: total,
      check_suites: await this.suitesRest(repository, suites),
    };
  }

  async rerequestSuite(
    { owner, repo, viewer }: GithubRepositoryTarget,
    id: string,
  ) {
    const { caller } = await this.writer(
      owner,
      repo,
      viewer,
      'POST /repos/:owner/:repo/check-suites/:id/rerequest',
    );
    await this.checks.rerequestSuite(
      caller,
      await checkIdOf(this.db, 'suite', id),
    );
    return {};
  }

  private async writer(
    owner: string,
    repo: string,
    viewer: GithubViewer | null,
    route: string,
  ): Promise<{ repository: RepositoryNode; caller: ChecksCaller }> {
    const { repository, viewer: signedIn } = await this.github.writable(
      owner,
      repo,
      viewer,
      route,
    );
    const installation = signedIn.installation;
    return {
      repository,
      caller: {
        ...this.github.ref(repository, signedIn),
        requesterId: signedIn.userId,
        installation: installation
          ? {
              installationId: installation.installationId,
              appId: installation.appId,
            }
          : null,
      },
    };
  }

  private context(repository: RepositoryNode) {
    return this.github.context(repository, { logins: [], labels: [] });
  }

  private async runsRest(repository: RepositoryNode, runs: CheckRunDTO[]) {
    const [ids, apps, context] = await Promise.all([
      checkRunNumericIdsOf(
        this.db,
        runs.map((run) => run.id),
      ),
      this.apps.byAppIds(runs.map((run) => run.app.appId)),
      this.context(repository),
    ]);
    return runs.map((run) =>
      toCheckRunRest(run, ids.get(run.id)!, apps.get(run.app.appId)!, context),
    );
  }

  private async suitesRest(
    repository: RepositoryNode,
    suites: CheckSuiteDTO[],
  ) {
    const [ids, apps, context] = await Promise.all([
      checkSuiteNumericIdsOf(
        this.db,
        suites.map((suite) => suite.id),
      ),
      this.apps.byAppIds(suites.map((suite) => suite.app.appId)),
      this.context(repository),
    ]);
    return suites.map((suite) =>
      toCheckSuiteRest(
        suite,
        ids.get(suite.id)!,
        apps.get(suite.app.appId)!,
        context,
      ),
    );
  }
}

function runInput(body: GithubUpdateCheckRunDTO): CheckRunInput {
  return {
    name: body.name,
    detailsUrl: body.details_url,
    externalId: body.external_id,
    status: body.status,
    conclusion: body.conclusion,
    startedAt: body.started_at ? new Date(body.started_at) : undefined,
    completedAt: body.completed_at ? new Date(body.completed_at) : undefined,
    output: body.output && {
      title: body.output.title,
      summary: body.output.summary,
      text: body.output.text,
      annotations: body.output.annotations?.map((annotation) => ({
        path: annotation.path,
        startLine: annotation.start_line,
        endLine: annotation.end_line,
        startColumn: annotation.start_column,
        endColumn: annotation.end_column,
        annotationLevel: annotation.annotation_level,
        message: annotation.message,
        title: annotation.title,
        rawDetails: annotation.raw_details,
      })),
    },
    actions: body.actions,
  };
}

function runsQuery(query: GithubCheckRunsQueryDTO) {
  return {
    checkName: query.check_name,
    status: query.status,
    filter: query.filter ?? 'latest',
    appId: query.app_id,
  };
}
