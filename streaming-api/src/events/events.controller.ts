import { Controller, Post, Body, HttpCode, HttpStatus } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bull';
import { Queue } from 'bull';

interface PlayEventDto {
  trackId: string;
}

@Controller('events')
export class EventsController {
  constructor(@InjectQueue('play-events') private playQueue: Queue) {}

  @Post('play')
  @HttpCode(HttpStatus.ACCEPTED)
  async registerPlay(@Body() body: PlayEventDto) {
    await this.playQueue.add({ trackId: body.trackId, timestamp: new Date().toISOString() });
    return { queued: true };
  }
}
