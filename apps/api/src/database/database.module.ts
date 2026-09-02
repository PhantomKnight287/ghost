import { Global, Inject, Module, type OnApplicationShutdown } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { createDatabase, type Database, type Pool } from '@ghost/db';

export const DATABASE_CONNECTION = 'DATABASE_CONNECTION';
export const DATABASE = 'DATABASE';

type Connection = { db: Database; pool: Pool };

@Global()
@Module({
  imports: [ConfigModule],
  providers: [
    {
      provide: DATABASE_CONNECTION,
      inject: [ConfigService],
      useFactory: (config: ConfigService): Connection =>
        createDatabase({
          connectionString: config.getOrThrow<string>('DATABASE_URL'),
        }),
    },
    {
      provide: DATABASE,
      inject: [DATABASE_CONNECTION],
      useFactory: ({ db }: Connection) => db,
    },
  ],
  exports: [DATABASE, DATABASE_CONNECTION],
})
export class DatabaseModule implements OnApplicationShutdown {
  constructor(
    @Inject(DATABASE_CONNECTION) private readonly connection: Connection,
  ) {}

  async onApplicationShutdown(): Promise<void> {
    await this.connection.pool.end();
  }
}
