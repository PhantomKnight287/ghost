import { ConfigService } from '@nestjs/config';
import { Test, type TestingModule } from '@nestjs/testing';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  EmptyAvatarError,
  UnsupportedAvatarTypeError,
} from '../../lib/avatars/avatar.errors.js';
import { S3Service } from '../s3/s3.service.js';
import { AvatarStorageService } from './avatar-storage.service.js';

const png = Buffer.from([0x89, 0x50, 0x4e, 0x47]);

describe('AvatarStorageService', () => {
  let service: AvatarStorageService;
  let s3: {
    bucket: string;
    putObject: ReturnType<typeof vi.fn>;
    deleteUnder: ReturnType<typeof vi.fn>;
  };

  beforeEach(async () => {
    s3 = {
      bucket: 'ghost',
      putObject: vi.fn().mockResolvedValue({}),
      deleteUnder: vi.fn().mockResolvedValue(undefined),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AvatarStorageService,
        { provide: S3Service, useValue: s3 },
        {
          provide: ConfigService,
          useValue: { getOrThrow: () => 'http://localhost:3001/' },
        },
      ],
    }).compile();

    service = module.get(AvatarStorageService);
  });

  it('stores the bytes under the owner and returns a servable URL', async () => {
    const { url } = await service.store({
      ownerId: 'user-1',
      contentType: 'image/png',
      body: png,
    });

    expect(s3.putObject).toHaveBeenCalledWith(
      expect.objectContaining({
        Bucket: 'ghost',
        Body: png,
        ContentType: 'image/png',
      }),
    );

    const { Key } = s3.putObject.mock.calls[0]![0];
    expect(Key).toMatch(/^avatars\/user-1\/[A-Za-z0-9_-]+\.png$/);
    expect(url).toBe(`http://localhost:3001/api/users/${Key}`);
  });

  it('drops the superseded avatars but keeps the one just written', async () => {
    await service.store({
      ownerId: 'user-1',
      contentType: 'image/png',
      body: png,
    });

    const written: string = s3.putObject.mock.calls[0]![0].Key;
    expect(s3.deleteUnder).toHaveBeenCalledWith('avatars/user-1/', [written]);
  });

  it('refuses anything that is not an allowed image, and empty bodies', async () => {
    await expect(
      service.store({
        ownerId: 'user-1',
        contentType: 'text/html',
        body: png,
      }),
    ).rejects.toBeInstanceOf(UnsupportedAvatarTypeError);

    await expect(
      service.store({
        ownerId: 'user-1',
        contentType: 'image/png',
        body: Buffer.alloc(0),
      }),
    ).rejects.toBeInstanceOf(EmptyAvatarError);

    expect(s3.putObject).not.toHaveBeenCalled();
  });

  it('accepts a content type that carries parameters', async () => {
    await service.store({
      ownerId: 'user-1',
      contentType: 'image/jpeg; charset=binary',
      body: png,
    });

    expect(s3.putObject.mock.calls[0]![0].Key).toMatch(/\.jpg$/);
  });

  it('refuses WebP, which next/og cannot decode', async () => {
    await expect(
      service.store({
        ownerId: 'user-1',
        contentType: 'image/webp',
        body: png,
      }),
    ).rejects.toBeInstanceOf(UnsupportedAvatarTypeError);
  });

  it('deletes every avatar the owner has when asked', async () => {
    await service.remove('user-1');

    expect(s3.deleteUnder).toHaveBeenCalledWith('avatars/user-1/', []);
  });
});
