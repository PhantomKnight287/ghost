import { Test, type TestingModule } from '@nestjs/testing';

import { RepositoryMutationsResolver } from './repository-mutations.resolver.js';
import { RepositoryMutationsService } from './repository-mutations.service.js';

describe('RepositoryMutationsResolver', () => {
  let resolver: RepositoryMutationsResolver;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        RepositoryMutationsResolver,
        { provide: RepositoryMutationsService, useValue: {} },
      ],
    }).compile();

    resolver = module.get<RepositoryMutationsResolver>(
      RepositoryMutationsResolver,
    );
  });

  it('should be defined', () => {
    expect(resolver).toBeDefined();
  });
});
