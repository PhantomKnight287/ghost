import { Controller, Get } from '@nestjs/common';
import { ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { AllowAnonymous } from '@thallesp/nestjs-better-auth';

import { GetRepositoryTemplatesResponseDTO } from './dto/repository-templates.dto.js';
import { RepositoryTemplatesService } from './repository-templates.service.js';

@Controller('repository-templates')
@ApiTags('Repositories')
export class RepositoryTemplatesController {
  constructor(private readonly templates: RepositoryTemplatesService) {}

  @Get()
  @AllowAnonymous()
  @ApiOperation({
    summary: 'List .gitignore and license templates',
    description:
      'What `gitignoreTemplate` and `licenseTemplate` take when creating a repository.',
  })
  @ApiOkResponse({ type: GetRepositoryTemplatesResponseDTO })
  list() {
    return this.templates.list();
  }
}
