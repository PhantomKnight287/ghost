import { Test, type TestingModule } from '@nestjs/testing';

import { IssueNodesService } from '../issue/issue-nodes.service.js';
import { IssueCommentResolver } from './issue-comment.resolver.js';

describe('IssueCommentResolver', () => {
  let resolver: IssueCommentResolver;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        IssueCommentResolver,
        { provide: IssueNodesService, useValue: {} },
      ],
    }).compile();

    resolver = module.get<IssueCommentResolver>(IssueCommentResolver);
  });

  it('should be defined', () => {
    expect(resolver).toBeDefined();
  });
});
