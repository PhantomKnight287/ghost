import { Test, TestingModule } from '@nestjs/testing';
import { DATABASE } from '../../../database/database.module.js';
import { ConfigService } from '@nestjs/config';
import { UsersService } from '../../../services/users/users.service.js';
import { UsersController } from './users.controller.js';

describe('UsersController', () => {
  let controller: UsersController;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [UsersController],
      providers: [
        { provide: UsersService, useValue: {} },
        { provide: ConfigService, useValue: {} },
        { provide: DATABASE, useValue: {} },
      ],
    }).compile();

    controller = module.get<UsersController>(UsersController);
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });
});
