import { Module } from '@nestjs/common';
import { CacheModule } from '@nestjs/cache-manager';
import { BullModule } from '@nestjs/bull';
import { StreamModule } from './stream/stream.module';
import { TracksModule } from './tracks/tracks.module';
import { EventsModule } from './events/events.module';

/**
 * BullMQ connection config.
 * - In production (Railway) we receive a single `REDIS_URL` connection string
 *   from the Redis add-on, which may use the `redis://` or `rediss://` scheme.
 * - Locally we fall back to host/port so `redis-server` on localhost just works.
 */
function bullRedisConfig() {
  const url = process.env.REDIS_URL;
  if (url) return { redis: url };
  return { redis: { host: 'localhost', port: 6379 } };
}

@Module({
  imports: [
    CacheModule.register({ isGlobal: true, ttl: 3600 }),
    BullModule.forRoot(bullRedisConfig()),
    StreamModule,
    TracksModule,
    EventsModule,
  ],
})
export class AppModule {}
