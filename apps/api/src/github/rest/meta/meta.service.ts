import { Injectable } from '@nestjs/common';

@Injectable()
export class MetaService {
  /** gh reads only the X-OAuth-Scopes header the root carries. */
  root() {
    return {};
  }

  /** `installed_version` decides which search syntax gh uses. */
  meta() {
    return {
      installed_version: '3.17.0',
      verifiable_password_authentication: false,
    };
  }
}
