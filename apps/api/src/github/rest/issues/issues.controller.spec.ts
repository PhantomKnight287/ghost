import { Test, type TestingModule } from '@nestjs/testing';

import { IssuesService } from '../../../resources/issues/issues.service.js';
import { IssuesController } from './issues.controller.js';
import { GithubIssuesService } from './issues.service.js';

describe('IssuesController', () => {
  let controller: IssuesController;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [IssuesController],
      providers: [
        { provide: GithubIssuesService, useValue: {} },
        { provide: IssuesService, useValue: {} },
      ],
    }).compile();

    controller = module.get<IssuesController>(IssuesController);
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });
});
