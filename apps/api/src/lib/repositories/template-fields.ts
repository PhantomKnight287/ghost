import {
  findGitignoreTemplate,
  findLicense,
  GITIGNORE_TEMPLATES,
  LICENSES,
} from '@ghost/templates';
import { applyDecorators } from '@nestjs/common';
import { Transform } from 'class-transformer';
import { IsIn, IsOptional } from 'class-validator';

/** A .gitignore template name in any case, handed on in GitHub's spelling so the service looks it up exactly. */
export const IsGitignoreTemplate = () =>
  applyDecorators(
    IsOptional(),
    Transform(({ value }) =>
      typeof value === 'string'
        ? (findGitignoreTemplate(value)?.name ?? value)
        : value,
    ),
    IsIn(Object.keys(GITIGNORE_TEMPLATES)),
  );

/** A license key in any case, handed on lowercased as GitHub keys it. */
export const IsLicenseTemplate = () =>
  applyDecorators(
    IsOptional(),
    Transform(({ value }) =>
      typeof value === 'string' ? (findLicense(value)?.key ?? value) : value,
    ),
    IsIn(LICENSES.map((license) => license.key)),
  );
