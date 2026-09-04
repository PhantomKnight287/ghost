import { writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { NestFactory } from '@nestjs/core';
import { SwaggerModule } from '@nestjs/swagger';

import { AppModule } from '../src/app.module.js';
import { openApiConfig } from '../src/lib/openapi.js';
import { GIT_TRANSPORT_ROUTES } from '../src/git/git.constants.js';

const target = resolve(
  dirname(fileURLToPath(import.meta.url)),
  '../openapi.json',
);

const app = await NestFactory.create(AppModule, {
  bodyParser: false,
  logger: false,
});

app.setGlobalPrefix('/api', { exclude: GIT_TRANSPORT_ROUTES });
const document = SwaggerModule.createDocument(app, openApiConfig);

await writeFile(target, `${JSON.stringify(document, null, 2)}\n`);
await app.close();

console.log(`Wrote ${target}`);
