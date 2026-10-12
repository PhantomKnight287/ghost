import { Test, type TestingModule } from '@nestjs/testing';

import { IssueMutationsResolver } from './issue-mutations.resolver.js';
import { IssueMutationsService } from './issue-mutations.service.js';

describe('IssueMutationsResolver', () => {
  let resolver: IssueMutationsResolver;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        IssueMutationsResolver,
        { provide: IssueMutationsService, useValue: {} },
      ],
    }).compile();

    resolver = module.get<IssueMutationsResolver>(IssueMutationsResolver);
  });

  it('should be defined', () => {
    expect(resolver).toBeDefined();
  });
});
