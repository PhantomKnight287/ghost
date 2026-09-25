import { ConfigService } from '@nestjs/config';
import { Test, TestingModule } from '@nestjs/testing';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { S3Service } from './s3.service.js';

const config = {
  S3_ENDPOINT: 'https://example.r2.cloudflarestorage.com',
  S3_ACCESS_KEY_ID: 'key',
  S3_SECRET_ACCESS_KEY: 'secret',
  S3_BUCKET: 'ghost',
};

describe('S3Service', () => {
  let service: S3Service;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        S3Service,
        {
          provide: ConfigService,
          useValue: {
            getOrThrow: (key: keyof typeof config) => config[key],
          },
        },
      ],
    }).compile();

    service = module.get<S3Service>(S3Service);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  it('exposes the bucket so callers do not each read config', () => {
    expect(service.bucket).toBe('ghost');
  });

  describe('deleteUnder', () => {
    it('deletes everything under the prefix except the kept keys', async () => {
      vi.spyOn(service, 'listObjectsV2').mockResolvedValue({
        Contents: [{ Key: 'p/a' }, { Key: 'p/b' }, {}],
      } as never);
      const deleteObjects = vi
        .spyOn(service, 'deleteObjects')
        .mockResolvedValue({} as never);

      await service.deleteUnder('p/', ['p/b']);

      expect(service.listObjectsV2).toHaveBeenCalledWith({
        Bucket: 'ghost',
        Prefix: 'p/',
      });
      expect(deleteObjects).toHaveBeenCalledWith({
        Bucket: 'ghost',
        Delete: { Objects: [{ Key: 'p/a' }] },
      });
    });

    it('sends no delete when nothing is stale', async () => {
      vi.spyOn(service, 'listObjectsV2').mockResolvedValue({} as never);
      const deleteObjects = vi.spyOn(service, 'deleteObjects');

      await service.deleteUnder('p/');

      expect(deleteObjects).not.toHaveBeenCalled();
    });
  });
});
