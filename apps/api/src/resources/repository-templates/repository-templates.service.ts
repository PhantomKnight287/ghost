import { Injectable } from '@nestjs/common';
import { GITIGNORE_TEMPLATES, LICENSES } from '@ghost/templates';

import type { GetRepositoryTemplatesResponseDTO } from './dto/repository-templates.dto.js';

@Injectable()
export class RepositoryTemplatesService {
  list(): GetRepositoryTemplatesResponseDTO {
    return {
      gitignore: Object.keys(GITIGNORE_TEMPLATES),
      licenses: LICENSES.map(({ key, name }) => ({ key, name })),
    };
  }
}
