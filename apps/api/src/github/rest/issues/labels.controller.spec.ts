import { Test, type TestingModule } from '@nestjs/testing';

import { LabelsController } from './labels.controller.js';
import { GithubLabelsService } from './labels.service.js';

describe('LabelsController', () => {
  let controller: LabelsController;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [LabelsController],
      providers: [{ provide: GithubLabelsService, useValue: {} }],
    }).compile();

    controller = module.get<LabelsController>(LabelsController);
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });
});
