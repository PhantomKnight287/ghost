import { ConfigService } from '@nestjs/config';
import { Test, type TestingModule } from '@nestjs/testing';

import { DATABASE } from '../../../database/database.module.js';
import { IssuesService } from '../../../resources/issues/issues.service.js';
import { RepositoryNodesService } from '../../graphql/resolvers/repository/repository-nodes.service.js';
import { GithubIssuesService } from './issues.service.js';

describe('GithubIssuesService', () => {
  let service: GithubIssuesService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        GithubIssuesService,
        { provide: DATABASE, useValue: {} },
        { provide: IssuesService, useValue: {} },
        { provide: RepositoryNodesService, useValue: {} },
        { provide: ConfigService, useValue: {} },
      ],
    }).compile();

    service = module.get<GithubIssuesService>(GithubIssuesService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });
});
