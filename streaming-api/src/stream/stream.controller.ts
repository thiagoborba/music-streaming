import {
  Controller,
  Get,
  Headers,
  HttpStatus,
  Param,
  Res,
} from '@nestjs/common';
import type { Response } from 'express';
import { StreamService } from './stream.service';

@Controller('stream')
export class StreamController {
  constructor(private readonly streamService: StreamService) {}

  @Get(':trackId')
  async streamTrack(
    @Param('trackId') trackId: string,
    @Headers('range') rangeHeader: string,
    @Res() res: Response,
  ): Promise<void> {
    const publicUrl = this.streamService.getPublicUrl(trackId);

    if (publicUrl) {
      res.redirect(302, publicUrl);
      return;
    }

    // Fallback local para dev sem credenciais Supabase
    const buffer = await this.streamService.getLocalBuffer(trackId);
    const fileSize = this.streamService.getFileSize(buffer);

    if (!rangeHeader) {
      res.setHeader('Content-Type', 'audio/mpeg');
      res.setHeader('Content-Length', fileSize);
      res.setHeader('Accept-Ranges', 'bytes');
      res.status(HttpStatus.OK);
      this.streamService.createRangeStream(buffer, 0, fileSize - 1).pipe(res);
      return;
    }

    const [startStr, endStr] = rangeHeader.replace(/bytes=/, '').split('-');
    const start = parseInt(startStr, 10);
    const end = endStr
      ? parseInt(endStr, 10)
      : Math.min(start + 1024 * 1024, fileSize - 1);

    if (start >= fileSize || end >= fileSize) {
      res.status(HttpStatus.REQUESTED_RANGE_NOT_SATISFIABLE).send();
      return;
    }

    const chunkSize = end - start + 1;
    res.status(HttpStatus.PARTIAL_CONTENT);
    res.setHeader('Content-Range', `bytes ${start}-${end}/${fileSize}`);
    res.setHeader('Accept-Ranges', 'bytes');
    res.setHeader('Content-Length', chunkSize);
    res.setHeader('Content-Type', 'audio/mpeg');
    this.streamService.createRangeStream(buffer, start, end).pipe(res);
  }
}
