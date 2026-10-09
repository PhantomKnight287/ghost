import { Test, TestingModule } from '@nestjs/testing';
import { IssueResolver } from '../issue/issue.resolver.js';
import { PullRequestResolver } from './pull-request.resolver.js';

describe('PullRequestResolver', () => {
  let resolver: PullRequestResolver;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [PullRequestResolver, { provide: IssueResolver, useValue: {} }],
    }).compile();

    resolver = module.get<PullRequestResolver>(PullRequestResolver);
  });

  it('should be defined', () => {
    expect(resolver).toBeDefined();
  });
});
