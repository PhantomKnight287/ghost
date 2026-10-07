import { Global, Module } from '@nestjs/common';

import { S3Service } from '../services/s3/s3.service.js';

/** One S3 client for the whole app, rather than one per module that touches object storage. */
@Global()
@Module({
  providers: [S3Service],
  exports: [S3Service],
})
export class S3Module {}
