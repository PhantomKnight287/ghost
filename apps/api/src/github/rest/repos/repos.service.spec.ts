import { ConfigService } from '@nestjs/config';
import { Test, type TestingModule } from '@nestjs/testing';

import { RepositoriesService } from '../../../resources/repositories/repositories.service.js';
import { RepositoryMaterializerService } from '../../../services/git/materializer/repository-materializer.service.js';
import { RepositoryNodesService } from '../../graphql/resolvers/repository/repository-nodes.service.js';
import { GithubReposService } from './repos.service.js';

describe('GithubReposService', () => {
  let service: GithubReposService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        GithubReposService,
        { provide: RepositoryNodesService, useValue: {} },
        { provide: RepositoryMaterializerService, useValue: {} },
        { provide: RepositoriesService, useValue: {} },
        { provide: ConfigService, useValue: {} },
      ],
    }).compile();

    service = module.get<GithubReposService>(GithubReposService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });
});
