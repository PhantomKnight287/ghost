// First import: the SDK has to patch http, pg and the rest before Nest pulls them in.
import './instrumentation.js';

import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module.js';
import { SwaggerModule } from '@nestjs/swagger';
import { apiReference } from '@scalar/nestjs-api-reference';
import morgan from 'morgan';
import { configureApp } from './app.setup.js';
import { openApiConfig } from './lib/openapi.js';

async function bootstrap() {
  const app = await NestFactory.create(AppModule, {
    bodyParser: false,
  });
  app.enableShutdownHooks();
  app.use(morgan('dev'));
  configureApp(app);

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
  const port = process.env.PORT ?? process.env.API_PORT ?? 3001; // Railway (and most PaaS) inject PORT; API_PORT stays for local dev.
  console.log(`Starting application on ${port}`);
  await app.listen(port);
}
await bootstrap();
