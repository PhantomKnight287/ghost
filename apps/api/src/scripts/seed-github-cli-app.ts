/**
 * Registers gh as a built-in OAuth app in a database migrated with `drizzle-kit migrate`, which seeds nothing. Deploys get it from packages/db's migrate.js. Safe to rerun.
 * node dist/scripts/seed-github-cli-app.js, after `nest build`
 */
import { type Database, seedBuiltInRows } from '@ghost/db';
import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { NestFactory } from '@nestjs/core';

import { DATABASE, DatabaseModule } from '../database/database.module.js';

@Module({
  imports: [ConfigModule.forRoot({ isGlobal: true }), DatabaseModule],
})
class SeedModule {}

const app = await NestFactory.createApplicationContext(SeedModule, {
  logger: ['warn', 'error'],
});
await seedBuiltInRows(app.get<Database>(DATABASE));
await app.close();
console.log('Built-in OAuth apps are registered');
