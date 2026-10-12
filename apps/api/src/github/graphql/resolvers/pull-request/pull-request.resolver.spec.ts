import { Test, type TestingModule } from '@nestjs/testing';

import { IssueNodesService } from '../issue/issue-nodes.service.js';
import { RepositoryNodesService } from '../repository/repository-nodes.service.js';
import { PullRequestResolver } from './pull-request.resolver.js';
import { PullRequestNodesService } from './pull-request-nodes.service.js';

describe('PullRequestResolver', () => {
  let resolver: PullRequestResolver;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        PullRequestResolver,
        { provide: PullRequestNodesService, useValue: {} },
        { provide: IssueNodesService, useValue: {} },
        { provide: RepositoryNodesService, useValue: {} },
      ],
    }).compile();

    resolver = module.get<PullRequestResolver>(PullRequestResolver);
  });

  it('should be defined', () => {
    expect(resolver).toBeDefined();
  });
});
