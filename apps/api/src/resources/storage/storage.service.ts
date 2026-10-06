import { type Database, schema } from '@ghost/db';
import { Inject, Injectable } from '@nestjs/common';
import { and, eq } from 'drizzle-orm';

import { DATABASE } from '../../database/database.module.js';
import type { StorageAccount } from '../../lib/storage/storage-account.js';
import { UserNotFoundError } from '../../lib/users/users.errors.js';
import { StorageQuotaService } from '../../services/storage/storage-quota.service.js';
import type { StorageUsageDTO } from './dto/storage.dto.js';

@Injectable()
export class StorageService {
  constructor(
    @Inject(DATABASE) private readonly db: Database,
    private readonly quota: StorageQuotaService,
  ) {}

  async usage(owner: string, requesterId: string): Promise<StorageUsageDTO> {
    const account = await this.accountNamed(owner, requesterId);
    return {
      usedBytes: await this.quota.usageOf(account, 'repository'),
      quotaBytes: await this.quota.quotaOf(account, 'repository'),
      maxAssetBytes: this.quota.maxAssetBytes,
      fork: {
        usedBytes: await this.quota.usageOf(account, 'fork'),
        quotaBytes: await this.quota.quotaOf(account, 'fork'),
      },
      lfs: {
        usedBytes: await this.quota.usageOf(account, 'lfs'),
        quotaBytes: await this.quota.quotaOf(account, 'lfs'),
      },
    };
  }

  /** The requester's own account, or an organization they belong to. Anything else reads as absent, so usage never tells a stranger an account exists. */
  private async accountNamed(
    owner: string,
    requesterId: string,
  ): Promise<StorageAccount> {
    const [organization] = await this.db
      .select({ id: schema.organization.id })
      .from(schema.organization)
      .innerJoin(
        schema.member,
        and(
          eq(schema.member.organizationId, schema.organization.id),
          eq(schema.member.userId, requesterId),
        ),
      )
      .where(eq(schema.organization.slug, owner));
    if (organization) return { organizationId: organization.id };

    const [user] = await this.db
      .select({ id: schema.user.id })
      .from(schema.user)
      .where(
        and(eq(schema.user.username, owner), eq(schema.user.id, requesterId)),
      );
    if (user) return { userId: user.id };

    throw new UserNotFoundError(owner);
  }
}
