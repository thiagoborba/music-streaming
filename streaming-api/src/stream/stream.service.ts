import { Injectable, NotFoundException } from '@nestjs/common';
import * as fs from 'fs';
import * as path from 'path';

@Injectable()
export class StreamService {
  private readonly audioDir = path.join(process.cwd(), 'audio');

  getTrackPath(trackId: string): string {
    const filePath = path.join(this.audioDir, `${trackId}.mp3`);
    if (!fs.existsSync(filePath)) {
      throw new NotFoundException(`Track ${trackId} not found`);
    }
    return filePath;
  }

  getFileSize(filePath: string): number {
    return fs.statSync(filePath).size;
  }

  createReadStream(filePath: string, start: number, end: number): fs.ReadStream {
    return fs.createReadStream(filePath, { start, end });
  }
}
