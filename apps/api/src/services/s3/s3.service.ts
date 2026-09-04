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
}
