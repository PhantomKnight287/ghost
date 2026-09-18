import { Inject, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { type Database, schema } from '@ghost/db';
import { and, count, eq, gte, inArray, lt, sum } from 'drizzle-orm';
import { nanoid } from 'nanoid';
import type { Readable } from 'node:stream';

import { DATABASE } from '../../database/database.module.js';
import { S3Service } from '../../services/s3/s3.service.js';
import { UsersService } from '../../services/users/users.service.js';
import {
  AVATAR_CONTENT_TYPES,
  AVATAR_PREFIX,
  type AvatarContentType,
} from './avatar.constants.js';
import type { UploadAvatarResponseDTO } from './dto/avatar.dto.js';
import type {
  GetUserContributionsQueryDTO,
  GetUserContributionsResponseDTO,
} from './dto/contributions.dto.js';
import type { UserProfileResponseDTO } from './dto/profile.dto.js';
import {
  AvatarNotFoundError,
  EmptyAvatarError,
  UnsupportedAvatarTypeError,
} from './user.errors.js';

export type AvatarObject = {
  stream: Readable;
  contentType: string;
  size?: number;
};

@Injectable()
export class UserService {
  private readonly publicUrl: string;

  constructor(
    @Inject(DATABASE) private readonly db: Database,
    private readonly users: UsersService,
    private readonly s3: S3Service,
    configService: ConfigService,
  ) {
    this.publicUrl = configService
      .getOrThrow<string>('BETTER_AUTH_URL')
      .replace(/\/+$/, '');
  }

  /** The public profile: anything a signed-out visitor may see. */
  async getProfile(username: string): Promise<UserProfileResponseDTO> {
    const user = await this.users.getUserByUsername(username);

    const publicRepositories = and(
      eq(schema.repository.ownerId, user.id),
      eq(schema.repository.visibility, 'public'),
    );

    const [[repositories], [stars]] = await Promise.all([
      this.db
        .select({ value: count() })
        .from(schema.repository)
        .where(publicRepositories),
      this.db
        .select({ value: count() })
        .from(schema.stars)
        .innerJoin(
          schema.repository,
          eq(schema.repository.id, schema.stars.repositoryId),
        )
        .where(publicRepositories),
    ]);

    return {
      username: user.username ?? username,
      name: user.name,
      image: user.image,
      joinedAt: user.createdAt.toISOString(),
      repositoryCount: repositories?.value ?? 0,
      starCount: stars?.value ?? 0,
    };
  }

  async uploadAvatar({
    userId,
    contentType,
    body,
  }: {
    userId: string;
    contentType: string;
    body: Buffer | undefined;
  }): Promise<UploadAvatarResponseDTO> {
    const extension =
      AVATAR_CONTENT_TYPES[
        contentType.split(';')[0]?.trim() as AvatarContentType
      ];

    if (!extension) throw new UnsupportedAvatarTypeError(contentType);
    if (!body?.length) throw new EmptyAvatarError();

    const name = `${nanoid()}.${extension}`;

    await this.s3.putObject({
      Bucket: this.s3.bucket,
      Key: this.avatarKey(userId, name),
      Body: body,
      ContentType: contentType,
    });

    await this.deleteAvatarObjects(userId, name);

    return { url: `${this.publicUrl}/api/users/avatars/${userId}/${name}` };
  }

  async deleteAvatar(userId: string): Promise<void> {
    await this.deleteAvatarObjects(userId);
  }

  async getAvatar(userId: string, name: string): Promise<AvatarObject> {
    try {
      const object = await this.s3.getObject({
        Bucket: this.s3.bucket,
        Key: this.avatarKey(userId, name),
      });

      if (!object.Body) throw new AvatarNotFoundError();

      return {
        stream: object.Body as Readable,
        contentType: object.ContentType ?? 'application/octet-stream',
        size: object.ContentLength,
      };
    } catch (error) {
      if (error instanceof AvatarNotFoundError) throw error;
      throw new AvatarNotFoundError();
    }
  }

  private avatarKey(userId: string, name: string) {
    return `${AVATAR_PREFIX}/${userId}/${name}`;
  }

  private async deleteAvatarObjects(userId: string, keep?: string) {
    const listed = await this.s3.listObjectsV2({
      Bucket: this.s3.bucket,
      Prefix: `${AVATAR_PREFIX}/${userId}/`,
    });

    const keepKey = keep && this.avatarKey(userId, keep);
    const stale = (listed.Contents ?? [])
      .map((object) => object.Key)
      .filter((key): key is string => Boolean(key) && key !== keepKey);

    if (!stale.length) return;

    await this.s3.deleteObjects({
      Bucket: this.s3.bucket,
      Delete: { Objects: stale.map((Key) => ({ Key })) },
    });
  }

  /**
   * Daily commit counts for the contribution graph, read straight from the
   * contribution index. This endpoint never touches git: indexing happens when
   * repositories are pushed or browsed, so rendering a profile cannot
   * materialize every repository the user owns.
   */
  async getContributions(
    username: string,
    query: GetUserContributionsQueryDTO = {},
    requesterId?: string,
  ): Promise<GetUserContributionsResponseDTO> {
    const user = await this.users.getUserByUsername(username);
    const now = new Date();
    const year =
      Number.isFinite(Number(query.year)) && Number(query.year) >= 2000
        ? Math.trunc(Number(query.year))
        : now.getUTCFullYear();

    const from = `${year}-01-01`;
    const to = `${year + 1}-01-01`;
    const counts = new Map<string, number>();

    // Private repositories are the owner's business: anyone else only sees
    // the public ones in the graph.
    const rows = await this.db
      .select({
        day: schema.repositoryContribution.day,
        count: sum(schema.repositoryContribution.commits),
      })
      .from(schema.repositoryContribution)
      .innerJoin(
        schema.repository,
        eq(schema.repository.id, schema.repositoryContribution.repositoryId),
      )
      .where(
        and(
          eq(schema.repository.ownerId, user.id),
          inArray(
            schema.repository.visibility,
            user.id === requesterId ? ['private', 'public'] : ['public'],
          ),
          eq(
            schema.repositoryContribution.authorEmail,
            user.email.toLowerCase(),
          ),
          gte(schema.repositoryContribution.day, from),
          lt(schema.repositoryContribution.day, to),
        ),
      )
      .groupBy(schema.repositoryContribution.day);

    for (const row of rows) {
      counts.set(row.day, Number(row.count ?? 0));
    }

    const days: { date: string; count: number }[] = [];
    for (
      let day = new Date(Date.UTC(year, 0, 1));
      day < new Date(Date.UTC(year + 1, 0, 1));
      day = new Date(day.getTime() + 86_400_000)
    ) {
      const date = day.toISOString().slice(0, 10);
      days.push({ date, count: counts.get(date) ?? 0 });
    }

    return {
      username: user.username ?? username,
      year,
      totalContributions: days.reduce((total, d) => total + d.count, 0),
      days,
    };
  }
}
