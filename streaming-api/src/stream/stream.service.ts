import { readFile } from 'fs/promises';
import { join } from 'path';
import { Injectable, NotFoundException } from '@nestjs/common';
import { Readable } from 'stream';

@Injectable()
export class StreamService {
  private readonly supabaseUrl = process.env.SUPABASE_URL?.replace(/\/$/, '');
  private readonly bucket = 'tracks';

  getPublicUrl(trackId: string): string | null {
    if (!this.supabaseUrl) return null;
    return `${this.supabaseUrl}/storage/v1/object/public/${this.bucket}/${trackId}.mp3`;
  }

  async getLocalBuffer(trackId: string): Promise<Buffer> {
    const filePath = join(process.cwd(), 'audio', `${trackId}.mp3`);
    try {
      return await readFile(filePath);
    } catch {
      throw new NotFoundException(
        `Track ${trackId} não encontrada em ${filePath}`,
      );
    }
  }

  getFileSize(buffer: Buffer): number {
    return buffer.length;
  }

  createRangeStream(buffer: Buffer, start: number, end: number): Readable {
    return Readable.from(buffer.subarray(start, end + 1));
  }
}
