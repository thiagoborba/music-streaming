import { Process, Processor } from '@nestjs/bull';
import { Logger } from '@nestjs/common';
import { Job } from 'bull';

@Processor('play-events')
export class PlayEventsProcessor {
  private readonly logger = new Logger(PlayEventsProcessor.name);
  private readonly playCounts = new Map<string, number>();

  @Process()
  async handlePlay(job: Job<{ trackId: string; timestamp: string }>): Promise<void> {
    const { trackId, timestamp } = job.data;
    const current = this.playCounts.get(trackId) ?? 0;
    this.playCounts.set(trackId, current + 1);
    this.logger.log(`Play registered: track=${trackId} total=${current + 1} at=${timestamp}`);
  }
}
