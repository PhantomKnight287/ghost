import { Test, TestingModule } from '@nestjs/testing';
import { AuthService } from '@thallesp/nestjs-better-auth';

import { DATABASE } from '../../database/database.module.js';
import { OauthAppsService } from './oauth-apps.service.js';

describe('OauthAppsService', () => {
  let service: OauthAppsService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        OauthAppsService,
        { provide: AuthService, useValue: {} },
        { provide: DATABASE, useValue: {} },
      ],
    }).compile();

    service = module.get<OauthAppsService>(OauthAppsService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });
});
