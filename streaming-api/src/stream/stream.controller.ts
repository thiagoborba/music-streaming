import {
  Controller,
  Get,
  Param,
  Headers,
  Res,
  HttpStatus,
} from '@nestjs/common';
import { Response } from 'express';
import { StreamService } from './stream.service';

@Controller('stream')
export class StreamController {
  constructor(private readonly streamService: StreamService) {}

  @Get(':trackId')
  streamTrack(
    @Param('trackId') trackId: string,
    @Headers('range') rangeHeader: string,
    @Res() res: Response,
  ): void {
    const filePath = this.streamService.getTrackPath(trackId);
    const fileSize = this.streamService.getFileSize(filePath);

    if (!rangeHeader) {
      res.setHeader('Content-Type', 'audio/mpeg');
      res.setHeader('Content-Length', fileSize);
      res.setHeader('Accept-Ranges', 'bytes');
      res.status(HttpStatus.OK);
      this.streamService.createReadStream(filePath, 0, fileSize - 1).pipe(res);
      return;
    }

    const [startStr, endStr] = rangeHeader.replace(/bytes=/, '').split('-');
    const start = parseInt(startStr, 10);
    const end = endStr ? parseInt(endStr, 10) : Math.min(start + 1024 * 1024, fileSize - 1);

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

    this.streamService.createReadStream(filePath, start, end).pipe(res);
  }
}
