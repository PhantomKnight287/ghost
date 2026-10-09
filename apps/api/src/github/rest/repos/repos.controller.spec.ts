import { Test, TestingModule } from '@nestjs/testing';
import { RepositoriesService } from '../../../resources/repositories/repositories.service.js';
import { ConfigService } from '@nestjs/config';
import { RepositoryResolver } from '../../graphql/resolvers/repository/repository.resolver.js';
import { RepositoryMaterializerService } from '../../../services/git/materializer/repository-materializer.service.js';
import { ReposController } from './repos.controller.js';

describe('ReposController', () => {
  let controller: ReposController;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [ReposController],
      providers: [
        { provide: RepositoryResolver, useValue: {} },
        { provide: RepositoryMaterializerService, useValue: {} },
        { provide: ConfigService, useValue: {} },
        { provide: RepositoriesService, useValue: {} },
      ],
    }).compile();

    controller = module.get<ReposController>(ReposController);
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });
});
