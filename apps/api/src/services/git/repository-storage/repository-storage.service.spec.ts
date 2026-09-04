import { Test, TestingModule } from '@nestjs/testing';
import { RepositoryStorageService } from './repository-storage.service.js';

describe('RepositoryStorageService', () => {
  let service: RepositoryStorageService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [RepositoryStorageService],
    }).compile();

    service = module.get<RepositoryStorageService>(RepositoryStorageService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });
});
