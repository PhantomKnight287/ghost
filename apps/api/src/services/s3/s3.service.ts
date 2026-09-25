import { S3 } from '@aws-sdk/client-s3';
import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

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

  /** Only the first 1,000 keys under the prefix are considered, which every caller stays well inside. */
  async deleteUnder(prefix: string, keep: string[] = []) {
    const listed = await this.listObjectsV2({
      Bucket: this.bucket,
      Prefix: prefix,
    });

    const stale = (listed.Contents ?? [])
      .map((object) => object.Key)
      .filter((key): key is string => key !== undefined && !keep.includes(key));

    if (!stale.length) return;

    await this.deleteObjects({
      Bucket: this.bucket,
      Delete: { Objects: stale.map((Key) => ({ Key })) },
    });
  }
}
