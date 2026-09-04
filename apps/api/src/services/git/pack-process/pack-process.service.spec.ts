import { Test, TestingModule } from '@nestjs/testing';
import { PackProcessService } from './pack-process.service.js';

describe('PackProcessService', () => {
  let service: PackProcessService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [PackProcessService],
    }).compile();

    service = module.get<PackProcessService>(PackProcessService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });
});
