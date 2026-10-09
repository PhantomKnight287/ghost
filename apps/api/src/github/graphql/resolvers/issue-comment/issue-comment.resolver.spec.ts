import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { IssueCommentResolver } from './issue-comment.resolver.js';

describe('IssueCommentResolver', () => {
  let resolver: IssueCommentResolver;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        IssueCommentResolver,
        { provide: ConfigService, useValue: {} },
      ],
    }).compile();

    resolver = module.get<IssueCommentResolver>(IssueCommentResolver);
  });

  it('should be defined', () => {
    expect(resolver).toBeDefined();
  });
});
