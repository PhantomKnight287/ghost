import { Test, TestingModule } from '@nestjs/testing';
import { DATABASE } from '../../../../database/database.module.js';
import { IssuesService } from '../../../../resources/issues/issues.service.js';
import { IssueResolver } from '../issue/issue.resolver.js';
import { RepositoryResolver } from '../repository/repository.resolver.js';
import { IssueMutationsResolver } from './issue-mutations.resolver.js';

describe('IssueMutationsResolver', () => {
  let resolver: IssueMutationsResolver;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        IssueMutationsResolver,
        { provide: DATABASE, useValue: {} },
        { provide: IssuesService, useValue: {} },
        { provide: RepositoryResolver, useValue: {} },
        { provide: IssueResolver, useValue: {} },
      ],
    }).compile();

    resolver = module.get<IssueMutationsResolver>(IssueMutationsResolver);
  });

  it('should be defined', () => {
    expect(resolver).toBeDefined();
  });
});
