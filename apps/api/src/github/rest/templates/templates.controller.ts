import { Controller, Get, Param, UseFilters } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';

import { SignInOptional } from '../../../auth/api-key-auth.guard.js';
import { GithubRestFilter } from '../github-rest.filter.js';
import { TemplatesService } from './templates.service.js';

@Controller('v3')
@ApiTags('GitHub compatibility')
@SignInOptional()
@UseFilters(GithubRestFilter)
export class TemplatesController {
  constructor(private readonly templates: TemplatesService) {}

  @Get('gitignore/templates')
  @ApiOperation({
    summary: 'Names `gitignore_template` takes when creating a repository',
  })
  gitignoreTemplates() {
    return this.templates.gitignoreTemplates();
  }

  @Get('gitignore/templates/:name')
  @ApiOperation({ summary: 'One .gitignore template and its source' })
  gitignoreTemplate(@Param('name') name: string) {
    return this.templates.gitignoreTemplate(name);
  }

  @Get('licenses')
  @ApiOperation({
    summary: 'Licenses `license_template` takes when creating a repository',
  })
  licenses() {
    return this.templates.licenses();
  }

  @Get('licenses/:license')
  @ApiOperation({ summary: 'One license with its full text' })
  license(@Param('license') license: string) {
    return this.templates.license(license);
  }
}
