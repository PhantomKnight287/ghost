import { Test, TestingModule } from '@nestjs/testing';
import { IssuesService } from '../../../../resources/issues/issues.service.js';
import { PullRequestsService } from '../../../../resources/pull-requests/pull-requests.service.js';
import { IssueResolver } from '../issue/issue.resolver.js';
import { IssueMutationsResolver } from '../issue-mutations/issue-mutations.resolver.js';
import { PullRequestMutationsResolver } from './pull-request-mutations.resolver.js';

describe('PullRequestMutationsResolver', () => {
  let resolver: PullRequestMutationsResolver;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        PullRequestMutationsResolver,
        { provide: PullRequestsService, useValue: {} },
        { provide: IssuesService, useValue: {} },
        { provide: IssueMutationsResolver, useValue: {} },
        { provide: IssueResolver, useValue: {} },
      ],
    }).compile();

    resolver = module.get<PullRequestMutationsResolver>(
      PullRequestMutationsResolver,
    );
  });

  it('should be defined', () => {
    expect(resolver).toBeDefined();
  });
});
