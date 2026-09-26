import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { nanoid } from 'nanoid';
import type { Readable } from 'node:stream';

import {
  AVATAR_CONTENT_TYPES,
  AVATAR_PREFIX,
  type AvatarContentType,
} from '../../lib/avatars/avatar.constants.js';
import {
  AvatarNotFoundError,
  EmptyAvatarError,
  UnsupportedAvatarTypeError,
} from '../../lib/avatars/avatar.errors.js';
import { S3Service } from '../s3/s3.service.js';

export type AvatarObject = {
  stream: Readable;
  contentType: string;
  size?: number;
};

/** Pictures for accounts and organizations, one live object per owner, keyed by the owner's id. */
@Injectable()
export class AvatarStorageService {
  private readonly publicUrl: string;

  constructor(
    private readonly s3: S3Service,
    configService: ConfigService,
  ) {
    this.publicUrl = configService
      .getOrThrow<string>('BETTER_AUTH_URL')
      .replace(/\/+$/, '');
  }

  async store({
    ownerId,
    contentType,
    body,
  }: {
    ownerId: string;
    contentType: string;
    body: Buffer | undefined;
  }) {
    const extension =
      AVATAR_CONTENT_TYPES[
        contentType.split(';')[0]?.trim() as AvatarContentType
      ];

    if (!extension) throw new UnsupportedAvatarTypeError(contentType);
    if (!body?.length) throw new EmptyAvatarError();

    const name = `${nanoid()}.${extension}`;

    await this.s3.putObject({
      Bucket: this.s3.bucket,
      Key: this.key(ownerId, name),
      Body: body,
      ContentType: contentType,
    });

    await this.removeAll(ownerId, name);

    return { url: `${this.publicUrl}/api/users/avatars/${ownerId}/${name}` };
  }

  async remove(ownerId: string) {
    await this.removeAll(ownerId);
  }

  async get(ownerId: string, name: string): Promise<AvatarObject> {
    try {
      const object = await this.s3.getObject({
        Bucket: this.s3.bucket,
        Key: this.key(ownerId, name),
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

  private key(ownerId: string, name: string) {
    return `${AVATAR_PREFIX}/${ownerId}/${name}`;
  }

  private async removeAll(ownerId: string, keep?: string) {
    await this.s3.deleteUnder(
      `${AVATAR_PREFIX}/${ownerId}/`,
      keep ? [this.key(ownerId, keep)] : [],
    );
  }
}
