import { PassThrough, type Readable } from 'node:stream';
import { type PutObjectCommandInput, S3 } from '@aws-sdk/client-s3';
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

  /** Uploads a stream that may fail midway, such as a request body whose client disconnects. The SDK neither settles nor handles an error from a destroyed body, which leaves the upload hanging and the error unhandled; here the source's failure aborts the upload and is the one error thrown. */
  async putStream(
    input: Omit<PutObjectCommandInput, 'Bucket' | 'Body'> & { Body: Readable },
  ) {
    const abort = new AbortController();
    const body = new PassThrough();
    // `pipe`, not `pipeline`: the SDK is reading `body`, and destroying it under the SDK raises an error nothing can catch. The abort signal alone ends the upload.
    const failed = new Promise<never>((_, reject) =>
      input.Body.once('error', (error) => {
        abort.abort();
        reject(error);
      }),
    );
    input.Body.pipe(body);

    await Promise.race([
      this.putObject(
        { ...input, Bucket: this.bucket, Body: body },
        { abortSignal: abort.signal },
      ),
      failed,
    ]);
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
