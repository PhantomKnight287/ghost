import { Controller, Get, Param, UseFilters } from '@nestjs/common';
import { ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';

import { SignInOptional } from '../../../auth/api-key-auth.guard.js';
import { GithubRestFilter } from '../github-rest.filter.js';
import { TemplatesService } from './templates.service.js';
import {
  GithubGitignoreTemplateDTO,
  GithubLicenseDTO,
  GithubLicenseSummaryDTO,
} from './dto/template.dto.js';
import { ApiGithubErrors } from '../dto/error.dto.js';

@Controller('v3')
@ApiTags('GitHub compatibility')
@SignInOptional()
@UseFilters(GithubRestFilter)
@ApiGithubErrors()
export class TemplatesController {
  constructor(private readonly templates: TemplatesService) {}

  @Get('gitignore/templates')
  @ApiOperation({
    summary: 'Names `gitignore_template` takes when creating a repository',
  })
  @ApiOkResponse({ schema: { type: 'array', items: { type: 'string' } } })
  gitignoreTemplates() {
    return this.templates.gitignoreTemplates();
  }

  @Get('gitignore/templates/:name')
  @ApiOperation({ summary: 'One .gitignore template and its source' })
  @ApiOkResponse({ type: GithubGitignoreTemplateDTO })
  gitignoreTemplate(@Param('name') name: string) {
    return this.templates.gitignoreTemplate(name);
  }

  @Get('licenses')
  @ApiOperation({
    summary: 'Licenses `license_template` takes when creating a repository',
  })
  @ApiOkResponse({ type: [GithubLicenseSummaryDTO] })
  licenses() {
    return this.templates.licenses();
  }

  @Get('licenses/:license')
  @ApiOperation({ summary: 'One license with its full text' })
  @ApiOkResponse({ type: GithubLicenseDTO })
  license(@Param('license') license: string) {
    return this.templates.license(license);
  }
}
