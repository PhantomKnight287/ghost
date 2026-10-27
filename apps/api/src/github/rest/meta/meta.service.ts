import { Injectable } from '@nestjs/common';

import type { GithubMetaDTO } from './dto/meta.dto.js';

@Injectable()
export class MetaService {
  /** gh reads only the X-OAuth-Scopes header the root carries. */
  root() {
    return {};
  }

  /** `installed_version` decides which search syntax gh uses. */
  meta(): GithubMetaDTO {
    return {
      installed_version: '3.17.0',
      verifiable_password_authentication: false,
    };
  }
}
