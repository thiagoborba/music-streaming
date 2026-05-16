import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { CacheModule } from '@nestjs/cache-manager';
import { BullModule } from '@nestjs/bull';
import { ThrottlerModule, ThrottlerGuard } from '@nestjs/throttler';
import { StreamModule } from './stream/stream.module';
import { TracksModule } from './tracks/tracks.module';
import { EventsModule } from './events/events.module';

function bullRedisConfig() {
  const url = process.env.REDIS_URL;
  if (url) return { redis: url };
  return { redis: { host: 'localhost', port: 6379 } };
}

@Module({
  imports: [
    ThrottlerModule.forRoot([{ ttl: 60_000, limit: 100 }]),
    CacheModule.register({ isGlobal: true, ttl: 3600 }),
    BullModule.forRoot(bullRedisConfig()),
    StreamModule,
    TracksModule,
    EventsModule,
  ],
  providers: [{ provide: APP_GUARD, useClass: ThrottlerGuard }],
})
export class AppModule {}
