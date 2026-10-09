import { Test, TestingModule } from '@nestjs/testing';
import { DATABASE } from '../../../../database/database.module.js';
import { RepositoriesService } from '../../../../resources/repositories/repositories.service.js';
import { RepositoryResolver } from '../repository/repository.resolver.js';
import { RepositoryMutationsResolver } from './repository-mutations.resolver.js';

describe('RepositoryMutationsResolver', () => {
  let resolver: RepositoryMutationsResolver;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        RepositoryMutationsResolver,
        { provide: DATABASE, useValue: {} },
        { provide: RepositoriesService, useValue: {} },
        { provide: RepositoryResolver, useValue: {} },
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
