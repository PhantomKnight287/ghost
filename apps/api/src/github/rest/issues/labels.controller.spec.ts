import { Test, type TestingModule } from '@nestjs/testing';

import { IssuesService } from '../../../resources/issues/issues.service.js';
import { LabelsController } from './labels.controller.js';
import { GithubIssuesService } from './issues.service.js';

describe('LabelsController', () => {
  let controller: LabelsController;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [LabelsController],
      providers: [
        { provide: GithubIssuesService, useValue: {} },
        { provide: IssuesService, useValue: {} },
      ],
    }).compile();

    controller = module.get<LabelsController>(LabelsController);
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });
});
