import { Test, type TestingModule } from '@nestjs/testing';

import { PullRequestMutationsResolver } from './pull-request-mutations.resolver.js';
import { PullRequestMutationsService } from './pull-request-mutations.service.js';

describe('PullRequestMutationsResolver', () => {
  let resolver: PullRequestMutationsResolver;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        PullRequestMutationsResolver,
        { provide: PullRequestMutationsService, useValue: {} },
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
