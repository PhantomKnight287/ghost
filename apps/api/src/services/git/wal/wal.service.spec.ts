import { Test, TestingModule } from '@nestjs/testing';
import { WalService } from './wal.service.js';

describe('WalService', () => {
  let service: WalService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [WalService],
    }).compile();

    service = module.get<WalService>(WalService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });
});
