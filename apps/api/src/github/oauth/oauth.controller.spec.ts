import { Test, TestingModule } from '@nestjs/testing';
import { AuthService } from '@thallesp/nestjs-better-auth';
import { DATABASE } from '../../database/database.module.js';
import { OauthController } from './oauth.controller.js';

describe('OauthController', () => {
  let controller: OauthController;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [OauthController],
      providers: [
        { provide: AuthService, useValue: {} },
        { provide: DATABASE, useValue: {} },
      ],
    }).compile();

    controller = module.get<OauthController>(OauthController);
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });
});
