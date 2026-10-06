import { Readable } from 'node:stream';
import { buffer } from 'node:stream/consumers';

/** In-memory stand-in for the few `S3Service` calls object uploads use. Like S3, a body shorter or longer than its `ContentLength` is refused. */
export class InMemoryS3 {
  readonly bucket = 'test';
  readonly objects = new Map<string, Buffer>();
  /** Set to make the next `putObject` fail, as a dropped connection would. */
  failNextPut = false;

  async putObject({
    Key,
    Body,
    ContentLength,
  }: {
    Key: string;
    Body: Readable | Buffer;
    ContentLength?: number;
  }) {
    const bytes = Buffer.isBuffer(Body) ? Body : await buffer(Body);
    if (this.failNextPut) {
      this.failNextPut = false;
      throw new Error('connection reset');
    }
    if (ContentLength !== undefined && bytes.length !== ContentLength) {
      throw new Error(`IncompleteBody: ${bytes.length} of ${ContentLength}`);
    }
    this.objects.set(Key, bytes);
    return {};
  }

  putStream(input: { Key: string; Body: Readable; ContentLength?: number }) {
    return this.putObject(input);
  }

  async getObject({ Key }: { Key: string }) {
    const bytes = this.objects.get(Key);
    if (!bytes)
      throw Object.assign(new Error('NoSuchKey'), { name: 'NoSuchKey' });
    return { Body: Readable.from([bytes]), ContentLength: bytes.length };
  }

  async copyObject({ Key, CopySource }: { Key: string; CopySource: string }) {
    const { Body } = await this.getObject({
      Key: CopySource.slice(this.bucket.length + 1),
    });
    this.objects.set(Key, await buffer(Body));
    return {};
  }

  async deleteObject({ Key }: { Key: string }) {
    this.objects.delete(Key);
    return {};
  }

  async deleteUnder(prefix: string) {
    for (const key of this.objects.keys()) {
      if (key.startsWith(prefix)) this.objects.delete(key);
    }
  }
}
