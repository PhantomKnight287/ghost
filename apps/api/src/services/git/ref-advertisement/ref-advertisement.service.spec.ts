import { Test, TestingModule } from '@nestjs/testing';
import { RefAdvertisementService } from './ref-advertisement.service.js';

describe('RefAdvertisementService', () => {
  let service: RefAdvertisementService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [RefAdvertisementService],
    }).compile();

    service = module.get<RefAdvertisementService>(RefAdvertisementService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });
});
