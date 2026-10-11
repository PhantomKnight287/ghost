import { Test, type TestingModule } from '@nestjs/testing';

import { IssuesService } from '../../../resources/issues/issues.service.js';
import { CommentsController } from './comments.controller.js';
import { GithubIssuesService } from './issues.service.js';

describe('CommentsController', () => {
  let controller: CommentsController;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [CommentsController],
      providers: [
        { provide: GithubIssuesService, useValue: {} },
        { provide: IssuesService, useValue: {} },
      ],
    }).compile();

    controller = module.get<CommentsController>(CommentsController);
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });
});
