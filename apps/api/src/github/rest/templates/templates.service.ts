import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  findGitignoreTemplate,
  findLicense,
  GITIGNORE_TEMPLATES,
  LICENSES,
} from '@ghost/templates';

import { GithubNotFoundError } from '../../../lib/github/github.errors.js';
import { githubOrigins } from '../../../lib/github/origins.js';
import type {
  GithubLicenseDTO,
  GithubLicenseSummaryDTO,
} from './dto/template.dto.js';

/** The .gitignore and license templates repository creation takes, as GitHub lists them. */
@Injectable()
export class TemplatesService {
  constructor(private readonly config: ConfigService) {}

  gitignoreTemplates() {
    return Object.keys(GITIGNORE_TEMPLATES);
  }

  gitignoreTemplate(name: string) {
    const template = findGitignoreTemplate(name);
    if (!template) throw new GithubNotFoundError();
    return template;
  }

  licenses(): GithubLicenseSummaryDTO[] {
    return LICENSES.map(({ key, name, spdx_id, node_id }) => ({
      key,
      name,
      spdx_id,
      url: this.licenseUrl(key),
      node_id,
    }));
  }

  license(key: string): GithubLicenseDTO {
    const license = findLicense(key);
    if (!license) throw new GithubNotFoundError();
    return { ...license, url: this.licenseUrl(license.key) };
  }

  private licenseUrl(key: string) {
    return `${githubOrigins(this.config).api}/api/v3/licenses/${key}`;
  }
}
