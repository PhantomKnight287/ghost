import { Test, type TestingModule } from '@nestjs/testing';

import { SearchResolver } from './search.resolver.js';
import { GithubSearchService } from './search.service.js';

describe('SearchResolver', () => {
  let resolver: SearchResolver;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        SearchResolver,
        { provide: GithubSearchService, useValue: {} },
      ],
    }).compile();

    resolver = module.get<SearchResolver>(SearchResolver);
  });

  it('should be defined', () => {
    expect(resolver).toBeDefined();
  });
});
