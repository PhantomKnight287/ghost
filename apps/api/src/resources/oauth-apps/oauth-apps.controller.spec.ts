import { Test, TestingModule } from '@nestjs/testing';
import { AuthService } from '@thallesp/nestjs-better-auth';

import { DATABASE } from '../../database/database.module.js';
import { AvatarStorageService } from '../../services/avatars/avatar-storage.service.js';
import { OauthAppsController } from './oauth-apps.controller.js';
import { OauthAppsService } from './oauth-apps.service.js';

describe('OauthAppsController', () => {
  let controller: OauthAppsController;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [OauthAppsController],
      providers: [
        OauthAppsService,
        { provide: AuthService, useValue: {} },
        { provide: DATABASE, useValue: {} },
        { provide: AvatarStorageService, useValue: {} },
      ],
    }).compile();

    controller = module.get<OauthAppsController>(OauthAppsController);
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });
});
