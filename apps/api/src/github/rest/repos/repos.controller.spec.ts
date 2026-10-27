import { ConfigService } from '@nestjs/config';
import { Test, type TestingModule } from '@nestjs/testing';

import { ReposController } from './repos.controller.js';
import { GithubReposService } from './repos.service.js';

describe('ReposController', () => {
  let controller: ReposController;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [ReposController],
      providers: [
        { provide: GithubReposService, useValue: {} },
        { provide: ConfigService, useValue: {} },
      ],
    }).compile();

    controller = module.get<ReposController>(ReposController);
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });
});
