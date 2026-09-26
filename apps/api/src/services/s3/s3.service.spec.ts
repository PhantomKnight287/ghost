import { ConfigService } from '@nestjs/config';
import { Test, TestingModule } from '@nestjs/testing';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { S3DeleteError } from '../../lib/s3/s3.errors.js';
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

    it('follows the listing past its first page', async () => {
      vi.spyOn(service, 'listObjectsV2')
        .mockResolvedValueOnce({
          Contents: [{ Key: 'p/a' }],
          NextContinuationToken: 'next',
        } as never)
        .mockResolvedValueOnce({ Contents: [{ Key: 'p/b' }] } as never);
      const deleteObjects = vi
        .spyOn(service, 'deleteObjects')
        .mockResolvedValue({} as never);

      await service.deleteUnder('p/');

      expect(service.listObjectsV2).toHaveBeenLastCalledWith({
        Bucket: 'ghost',
        Prefix: 'p/',
        ContinuationToken: 'next',
      });
      expect(deleteObjects).toHaveBeenCalledTimes(2);
    });

    it('throws when any object survives the delete', async () => {
      vi.spyOn(service, 'listObjectsV2').mockResolvedValue({
        Contents: [{ Key: 'p/a' }],
      } as never);
      vi.spyOn(service, 'deleteObjects').mockResolvedValue({
        Errors: [{ Key: 'p/a', Code: 'AccessDenied' }],
      } as never);

      await expect(service.deleteUnder('p/')).rejects.toThrow(S3DeleteError);
    });

    it('sends no delete when nothing is stale', async () => {
      vi.spyOn(service, 'listObjectsV2').mockResolvedValue({} as never);
      const deleteObjects = vi.spyOn(service, 'deleteObjects');

      await service.deleteUnder('p/');

      expect(deleteObjects).not.toHaveBeenCalled();
    });
  });
});
