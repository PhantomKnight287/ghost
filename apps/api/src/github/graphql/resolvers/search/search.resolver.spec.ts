import { Test, TestingModule } from '@nestjs/testing';
import { IssuesService } from '../../../../resources/issues/issues.service.js';
import { RepositoryResolver } from '../repository/repository.resolver.js';
import { SearchResolver } from './search.resolver.js';

describe('SearchResolver', () => {
  let resolver: SearchResolver;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        SearchResolver,
        { provide: IssuesService, useValue: {} },
        { provide: RepositoryResolver, useValue: {} },
      ],
    }).compile();

    resolver = module.get<SearchResolver>(SearchResolver);
  });

  it('should be defined', () => {
    expect(resolver).toBeDefined();
  });
});
