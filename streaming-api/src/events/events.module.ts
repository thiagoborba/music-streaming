import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bull';
import { EventsController } from './events.controller';
import { PlayEventsProcessor } from './play-events.processor';

@Module({
  imports: [BullModule.registerQueue({ name: 'play-events' })],
  controllers: [EventsController],
  providers: [PlayEventsProcessor],
})
export class EventsModule {}
