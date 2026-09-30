import { type Database, schema } from '@ghost/db';
import { Inject, Injectable, type OnModuleInit } from '@nestjs/common';
import { and, count, eq, gt, lte, sql, sum } from 'drizzle-orm';

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

    this.observeDelivery();
  }

  /** apps/delivery has no metrics of its own; its tables say how it is doing. */
  private observeDelivery() {
    const jobs = meter.createObservableGauge('ghost.delivery.jobs', {
      description:
        'Delivery jobs, by kind and status. Finished ones are pruned after 30 days.',
    });
    const lag = meter.createObservableGauge('ghost.delivery.lag', {
      unit: 's',
      description:
        'How overdue the most overdue pending job is: near zero while apps/delivery keeps up.',
    });
    const attempts = meter.createObservableGauge('ghost.delivery.attempts', {
      description: 'Webhook attempts in the last five minutes, by outcome.',
    });
    const p99 = meter.createObservableGauge('ghost.delivery.attempt.p99', {
      unit: 'ms',
      description: 'p99 webhook attempt duration over the last five minutes.',
    });

    meter.addBatchObservableCallback(
      async (result) => {
        const [jobRows, [lagRow], [attemptRow]] = await Promise.all([
          this.db
            .select({
              kind: schema.deliveryJob.kind,
              status: schema.deliveryJob.status,
              total: count(),
            })
            .from(schema.deliveryJob)
            .groupBy(schema.deliveryJob.kind, schema.deliveryJob.status),
          this.db
            .select({
              seconds: sql<number>`coalesce(extract(epoch from max(now() - ${schema.deliveryJob.nextAttemptAt})), 0)::float`,
            })
            .from(schema.deliveryJob)
            .where(
              and(
                eq(schema.deliveryJob.status, 'pending'),
                lte(schema.deliveryJob.nextAttemptAt, sql`now()`),
              ),
            ),
          this.db
            .select({
              succeeded: sql<number>`count(*) filter (where ${schema.deliveryAttempt.statusCode} between 200 and 299)::int`,
              failed: sql<number>`count(*) filter (where ${schema.deliveryAttempt.statusCode} is null or ${schema.deliveryAttempt.statusCode} not between 200 and 299)::int`,
              p99: sql<number>`coalesce(percentile_cont(0.99) within group (order by ${schema.deliveryAttempt.durationMs}), 0)::float`,
            })
            .from(schema.deliveryAttempt)
            .where(
              gt(
                schema.deliveryAttempt.startedAt,
                sql`now() - interval '5 minutes'`,
              ),
            ),
        ]);

        for (const row of jobRows) {
          result.observe(jobs, row.total, {
            kind: row.kind,
            status: row.status,
          });
        }
        result.observe(lag, lagRow?.seconds ?? 0);
        result.observe(attempts, attemptRow?.succeeded ?? 0, {
          outcome: 'succeeded',
        });
        result.observe(attempts, attemptRow?.failed ?? 0, {
          outcome: 'failed',
        });
        result.observe(p99, attemptRow?.p99 ?? 0);
      },
      [jobs, lag, attempts, p99],
    );
  }
}
