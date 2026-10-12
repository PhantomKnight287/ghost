import { Test, type TestingModule } from '@nestjs/testing';

import { RepositoryNodesService } from '../repository/repository-nodes.service.js';
import { IssueResolver } from './issue.resolver.js';
import { IssueNodesService } from './issue-nodes.service.js';

describe('IssueResolver', () => {
  let resolver: IssueResolver;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        IssueResolver,
        { provide: IssueNodesService, useValue: {} },
        { provide: RepositoryNodesService, useValue: {} },
      ],
    }).compile();

    resolver = module.get<IssueResolver>(IssueResolver);
  });

  it('should be defined', () => {
    expect(resolver).toBeDefined();
  });
});
