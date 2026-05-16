import {
  Controller,
  Get,
  Post,
  Param,
  NotFoundException,
} from '@nestjs/common';
import { SkipThrottle } from '@nestjs/throttler';
import { TracksService } from './tracks.service';

@SkipThrottle()
@Controller('tracks')
export class TracksController {
  constructor(private readonly tracksService: TracksService) {}

  @Get()
  async findAll() {
    return this.tracksService.findAll();
  }

  @Get(':id')
  async findOne(@Param('id') id: string) {
    const track = await this.tracksService.findOne(id);
    if (!track) throw new NotFoundException(`Track ${id} not found`);
    return track;
  }

  @Post('refresh')
  async refresh() {
    const count = await this.tracksService.refresh();
    return { count };
  }
}
