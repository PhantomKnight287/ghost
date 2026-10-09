import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { DATABASE } from '../../../../database/database.module.js';
import { RepositoryAccessService } from '../../../../services/git/repository-access/repository-access.service.js';
import { IssuesService } from '../../../../resources/issues/issues.service.js';
import { RepositoryResolver } from './repository.resolver.js';

describe('RepositoryResolver', () => {
  let resolver: RepositoryResolver;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        RepositoryResolver,
        { provide: DATABASE, useValue: {} },
        { provide: RepositoryAccessService, useValue: {} },
        { provide: ConfigService, useValue: {} },
        { provide: IssuesService, useValue: {} },
      ],
    }).compile();

    resolver = module.get<RepositoryResolver>(RepositoryResolver);
  });

  it('should be defined', () => {
    expect(resolver).toBeDefined();
  });
});
