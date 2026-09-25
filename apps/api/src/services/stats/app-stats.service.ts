import { type Database, schema } from '@ghost/db';
import { Inject, Injectable, type OnModuleInit } from '@nestjs/common';
import { count, eq, sum } from 'drizzle-orm';

import { DATABASE } from '../../database/database.module.js';
import { meter } from '../../lib/metrics.js';

/** Instance totals, read once per metric collection so they can be plotted over time. Counts, not histories: a repository deleted today lowers the line. */
@Injectable()
export class AppStatsService implements OnModuleInit {
  constructor(@Inject(DATABASE) private readonly db: Database) {}

  onModuleInit(): void {
    const repositories = meter.createObservableGauge('ghost.repositories', {
      description: 'Repositories on this instance.',
    });
    const commits = meter.createObservableGauge('ghost.commits', {
      description: 'Commits indexed on default branches.',
    });
    const users = meter.createObservableGauge('ghost.users', {
      description: 'Registered accounts.',
    });
    const issues = meter.createObservableGauge('ghost.issues', {
      description: 'Issues, by state.',
    });
    const pullRequests = meter.createObservableGauge('ghost.pull_requests', {
      description: 'Pull requests, by state.',
    });
    const stars = meter.createObservableGauge('ghost.stars', {
      description: 'Stars across every repository.',
    });

    meter.addBatchObservableCallback(
      async (result) => {
        const [
          repositoryRows,
          [commitRow],
          [userRow],
          issueRows,
          pullRequestRows,
          [starRow],
        ] = await Promise.all([
          this.db
            .select({
              visibility: schema.repository.visibility,
              total: count(),
            })
            .from(schema.repository)
            .groupBy(schema.repository.visibility),
          // ponytail: a full scan of the contribution index. One aggregate a minute; give it a rollup table if that stops being cheap.
          this.db
            .select({ total: sum(schema.repositoryContribution.commits) })
            .from(schema.repositoryContribution),
          this.db.select({ total: count() }).from(schema.user),
          this.db
            .select({ state: schema.issue.state, total: count() })
            .from(schema.issue)
            .where(eq(schema.issue.isPullRequest, false))
            .groupBy(schema.issue.state),
          this.db
            .select({ state: schema.pullRequest.state, total: count() })
            .from(schema.pullRequest)
            .groupBy(schema.pullRequest.state),
          this.db.select({ total: count() }).from(schema.stars),
        ]);

        for (const row of repositoryRows) {
          result.observe(repositories, row.total, {
            visibility: row.visibility,
          });
        }
        for (const row of issueRows) {
          result.observe(issues, row.total, { state: row.state });
        }
        for (const row of pullRequestRows) {
          result.observe(pullRequests, row.total, { state: row.state });
        }

        result.observe(commits, Number(commitRow?.total ?? 0));
        result.observe(users, userRow?.total ?? 0);
        result.observe(stars, starRow?.total ?? 0);
      },
      [repositories, commits, users, issues, pullRequests, stars],
    );
  }
}
