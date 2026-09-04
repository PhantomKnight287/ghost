import { describe, it, expect, beforeEach, vi } from 'vitest';
import { Test, TestingModule } from '@nestjs/testing';

import { GitController } from './git.controller.js';
import { GitService } from './git.service.js';

describe('GitController', () => {
  let controller: GitController;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [GitController],
      providers: [
        {
          provide: GitService,
          useValue: {
            advertiseRefs: vi.fn(),
            uploadPack: vi.fn(),
            receivePack: vi.fn(),
          },
        },
      ],
    }).compile();

    controller = module.get<GitController>(GitController);
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });
});
