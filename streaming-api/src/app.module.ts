import { Module } from '@nestjs/common';
import { CacheModule } from '@nestjs/cache-manager';
import { BullModule } from '@nestjs/bull';
import { StreamModule } from './stream/stream.module';
import { TracksModule } from './tracks/tracks.module';
import { EventsModule } from './events/events.module';

@Module({
  imports: [
    CacheModule.register({ isGlobal: true, ttl: 3600 }),
    BullModule.forRoot({ redis: { host: 'localhost', port: 6379 } }),
    StreamModule,
    TracksModule,
    EventsModule,
  ],
})
export class AppModule {}
