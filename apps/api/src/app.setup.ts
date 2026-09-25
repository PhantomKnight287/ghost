import { type INestApplication, ValidationPipe } from '@nestjs/common';

import { DomainErrorFilter } from './filters/domain-error/domain-error.filter.js';
import { GIT_TRANSPORT_ROUTES } from './git/git.constants.js';

/** What every running instance needs, shared by `main.ts` and the end-to-end suite so the two cannot drift. The app must be created with `bodyParser: false`. */
export function configureApp(app: INestApplication) {
  app.useGlobalPipes(new ValidationPipe({ transform: true }));
  app.useGlobalFilters(new DomainErrorFilter());
  // offset all CRUD apis to /api prefix so it does not conflict with git's rest stuff
  app.setGlobalPrefix('/api', { exclude: GIT_TRANSPORT_ROUTES });
}
