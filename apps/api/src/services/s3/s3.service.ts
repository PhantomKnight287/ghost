import { S3 } from '@aws-sdk/client-s3';
import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import { S3DeleteError } from '../../lib/s3/s3.errors.js';

@Injectable()
export class S3Service extends S3 {
  readonly bucket: string;

  constructor(protected readonly configService: ConfigService) {
    super({
      forcePathStyle: true,
      endpoint: configService.getOrThrow('S3_ENDPOINT'),
      region: 'auto',
      credentials: {
        accessKeyId: configService.getOrThrow('S3_ACCESS_KEY_ID'),
        secretAccessKey: configService.getOrThrow('S3_SECRET_ACCESS_KEY'),
      },
    });
    this.bucket = configService.getOrThrow('S3_BUCKET');
  }

  /** Throws unless every listed key is gone: DeleteObjects reports per-key failures in its response body instead of failing the request. */
  async deleteUnder(prefix: string, keep: string[] = []) {
    let ContinuationToken: string | undefined;
    do {
      const listed = await this.listObjectsV2({
        Bucket: this.bucket,
        Prefix: prefix,
        ContinuationToken,
      });
      ContinuationToken = listed.NextContinuationToken;

      const stale = (listed.Contents ?? [])
        .map((object) => object.Key)
        .filter(
          (key): key is string => key !== undefined && !keep.includes(key),
        );
      if (!stale.length) continue;

      const { Errors } = await this.deleteObjects({
        Bucket: this.bucket,
        Delete: { Objects: stale.map((Key) => ({ Key })) },
      });
      if (Errors?.length) throw new S3DeleteError(prefix, Errors);
    } while (ContinuationToken);
  }
}
