import { Test, type TestingModule } from '@nestjs/testing';

import { ViewerResolver } from './viewer.resolver.js';
import { ViewerService } from './viewer.service.js';

describe('ViewerResolver', () => {
  let resolver: ViewerResolver;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [ViewerResolver, { provide: ViewerService, useValue: {} }],
    }).compile();

    resolver = module.get<ViewerResolver>(ViewerResolver);
  });

  it('should be defined', () => {
    expect(resolver).toBeDefined();
  });
});
