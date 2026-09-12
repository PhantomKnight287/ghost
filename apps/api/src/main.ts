import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module.js';
import { SwaggerModule } from '@nestjs/swagger';
import { apiReference } from '@scalar/nestjs-api-reference';
import { ValidationPipe } from '@nestjs/common';
import { DomainErrorFilter } from './filters/domain-error/domain-error.filter.js';
import { openApiConfig } from './lib/openapi.js';
import { GIT_TRANSPORT_ROUTES } from './git/git.constants.js';
import morgan from 'morgan';

async function bootstrap() {
  const app = await NestFactory.create(AppModule, {
    bodyParser: false,
  });
  app.enableShutdownHooks();
  app.useGlobalPipes(new ValidationPipe({ transform: true }));
  app.use(morgan('dev'));
  app.useGlobalFilters(new DomainErrorFilter());
  // offset all CRUD apis to /api prefix so it does not conflict with git's rest stuff
  app.setGlobalPrefix('/api', { exclude: GIT_TRANSPORT_ROUTES });

  const document = SwaggerModule.createDocument(app, openApiConfig);
  app.use(
    '/reference',
    apiReference({ content: document, theme: 'deepSpace' }),
  );

  app.enableCors({
    origin: (process.env.AUTH_TRUSTED_ORIGINS ?? 'http://localhost:3000')
      .split(',')
      .map((origin) => origin.trim())
      .filter(Boolean),
    credentials: true,
  });
  // Railway (and most PaaS) inject PORT; API_PORT stays for local dev.
  await app.listen(process.env.PORT ?? process.env.API_PORT ?? 3001);
}
await bootstrap();
