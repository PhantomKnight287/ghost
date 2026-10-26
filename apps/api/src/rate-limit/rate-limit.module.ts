import {
  Global,
  Inject,
  Module,
  type OnApplicationShutdown,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Redis } from 'ioredis';

import { REDIS } from '../lib/rate-limit/redis.js';
import { RateLimiterService } from '../services/rate-limit/rate-limiter.service.js';
import { RateLimitGuard } from './rate-limit.guard.js';

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
    RateLimitGuard,
  ],
  exports: [REDIS, RateLimiterService, RateLimitGuard],
})
export class RateLimitModule implements OnApplicationShutdown {
  constructor(@Inject(REDIS) private readonly redis: Redis) {}

  async onApplicationShutdown(): Promise<void> {
    await this.redis.quit();
  }
}
