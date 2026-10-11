import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { DATABASE } from '../../../../database/database.module.js';
import { IssuesService } from '../../../../resources/issues/issues.service.js';
import { RepositoryResolver } from '../repository/repository.resolver.js';
import { IssueResolver } from './issue.resolver.js';

describe('IssueResolver', () => {
  let resolver: IssueResolver;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        IssueResolver,
        { provide: DATABASE, useValue: {} },
        { provide: IssuesService, useValue: {} },
        { provide: RepositoryResolver, useValue: {} },
        { provide: ConfigService, useValue: {} },
      ],
    }).compile();

    resolver = module.get<IssueResolver>(IssueResolver);
  });

  it('should be defined', () => {
    expect(resolver).toBeDefined();
  });
});
