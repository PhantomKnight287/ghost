import { Test, type TestingModule } from '@nestjs/testing';

import { OauthController } from './oauth.controller.js';
import { OauthService } from './oauth.service.js';

describe('OauthController', () => {
  let controller: OauthController;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [OauthController],
      providers: [{ provide: OauthService, useValue: {} }],
    }).compile();

    controller = module.get<OauthController>(OauthController);
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });
});
