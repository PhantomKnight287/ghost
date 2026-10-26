import {
  Global,
  Inject,
  Module,
  type OnApplicationShutdown,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Redis } from 'ioredis';

import {
  REDIS,
  RateLimiterService,
} from '../services/rate-limit/rate-limiter.service.js';

@Global()
@Module({
  providers: [
    {
      provide: REDIS,
      inject: [ConfigService],
      // No offline queue: a request while Redis is down fails at once, and the limiter answers 503 instead of hanging.
      useFactory: async (config: ConfigService) => {
        const redis = new Redis(config.getOrThrow<string>('REDIS_URL'), {
          lazyConnect: true,
          enableOfflineQueue: false,
          maxRetriesPerRequest: 1,
        });
        await redis.connect();
        return redis;
      },
    },
    RateLimiterService,
  ],
  exports: [REDIS, RateLimiterService],
})
export class RateLimitModule implements OnApplicationShutdown {
  constructor(@Inject(REDIS) private readonly redis: Redis) {}

  async onApplicationShutdown(): Promise<void> {
    await this.redis.quit();
  }
}
