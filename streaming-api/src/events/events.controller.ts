import { Controller, Post, Body, HttpCode, HttpStatus } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { InjectQueue } from '@nestjs/bull';
import type { Queue } from 'bull';

interface PlayEventDto {
  trackId: string;
}

@Controller('events')
export class EventsController {
  constructor(@InjectQueue('play-events') private playQueue: Queue) {}

  @Post('play')
  @Throttle({ default: { ttl: 60_000, limit: 30 } })
  @HttpCode(HttpStatus.ACCEPTED)
  async registerPlay(@Body() body: PlayEventDto) {
    await this.playQueue.add({
      trackId: body.trackId,
      timestamp: new Date().toISOString(),
    });
    return { queued: true };
  }
}
