import { Controller, Get, Param, NotFoundException } from '@nestjs/common';
import { TracksService } from './tracks.service';

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
}
