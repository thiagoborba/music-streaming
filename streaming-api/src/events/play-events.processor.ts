import { Process, Processor } from '@nestjs/bull';
import { Inject, Logger } from '@nestjs/common';
import { CACHE_MANAGER } from '@nestjs/cache-manager';
import type { Cache } from 'cache-manager';
import type { Job } from 'bull';

@Processor('play-events')
export class PlayEventsProcessor {
  private readonly logger = new Logger(PlayEventsProcessor.name);

  constructor(@Inject(CACHE_MANAGER) private cache: Cache) {}

  @Process()
  async handlePlay(
    job: Job<{ trackId: string; timestamp: string }>,
  ): Promise<void> {
    const { trackId, timestamp } = job.data;
    const current = (await this.cache.get<number>(`plays:${trackId}`)) ?? 0;
    const next = current + 1;
    await this.cache.set(`plays:${trackId}`, next, 0);
    this.logger.log(
      `Play registered: track=${trackId} total=${next} at=${timestamp}`,
    );
  }
}
