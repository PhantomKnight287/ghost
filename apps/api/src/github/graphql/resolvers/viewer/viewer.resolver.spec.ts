import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { DATABASE } from '../../../../database/database.module.js';
import { RepositoryResolver } from '../repository/repository.resolver.js';
import { ViewerResolver } from './viewer.resolver.js';

describe('ViewerResolver', () => {
  let resolver: ViewerResolver;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ViewerResolver,
        { provide: DATABASE, useValue: {} },
        { provide: ConfigService, useValue: {} },
        { provide: RepositoryResolver, useValue: {} },
      ],
    }).compile();

    resolver = module.get<ViewerResolver>(ViewerResolver);
  });

  it('should be defined', () => {
    expect(resolver).toBeDefined();
  });
});
