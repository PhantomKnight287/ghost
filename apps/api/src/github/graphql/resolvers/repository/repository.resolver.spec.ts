import { Test, type TestingModule } from '@nestjs/testing';

import { RepositoryResolver } from './repository.resolver.js';
import { RepositoryNodesService } from './repository-nodes.service.js';

describe('RepositoryResolver', () => {
  let resolver: RepositoryResolver;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        RepositoryResolver,
        { provide: RepositoryNodesService, useValue: {} },
      ],
    }).compile();

    resolver = module.get<RepositoryResolver>(RepositoryResolver);
  });

  it('should be defined', () => {
    expect(resolver).toBeDefined();
  });
});
