import { readFile } from 'fs/promises';
import { join } from 'path';
import {
  Injectable,
  Logger,
  NotFoundException,
  OnModuleInit,
} from '@nestjs/common';
import { createClient, SupabaseClient } from '@supabase/supabase-js';
import { Readable } from 'stream';

@Injectable()
export class StreamService implements OnModuleInit {
  private readonly logger = new Logger(StreamService.name);
  private readonly bucket = 'audio';
  private supabase: SupabaseClient | null = null;
  private readonly buffers = new Map<string, Buffer>();
  private readonly inflight = new Map<string, Promise<Buffer>>();

  onModuleInit(): void {
    const url = process.env.SUPABASE_URL;
    const key = process.env.SUPABASE_KEY;
    if (url && key) {
      this.supabase = createClient(url, key, {
        auth: { persistSession: false },
      });
      this.logger.log('Modo produção: áudio via Supabase Storage');
    } else {
      this.logger.warn(
        'SUPABASE_URL/SUPABASE_KEY não definidos — modo local: lendo de audio/',
      );
    }
  }

  async getTrackBuffer(trackId: string): Promise<Buffer> {
    const cached = this.buffers.get(trackId);
    if (cached) return cached;

    const existing = this.inflight.get(trackId);
    if (existing) return existing;

    const source = this.supabase
      ? () => this.downloadFromSupabase(trackId)
      : () => this.readLocalFile(trackId);

    const fetchPromise = source()
      .then((buf) => {
        this.buffers.set(trackId, buf);
        return buf;
      })
      .finally(() => {
        this.inflight.delete(trackId);
      });

    this.inflight.set(trackId, fetchPromise);
    return fetchPromise;
  }

  getFileSize(buffer: Buffer): number {
    return buffer.length;
  }

  createRangeStream(buffer: Buffer, start: number, end: number): Readable {
    return Readable.from(buffer.subarray(start, end + 1));
  }

  private async downloadFromSupabase(trackId: string): Promise<Buffer> {
    const objectPath = `${trackId}.mp3`;
    const { data, error } = await this.supabase!.storage.from(
      this.bucket,
    ).download(objectPath);

    if (error || !data) {
      this.logger.warn(
        `Supabase download falhou para ${objectPath}: ${error?.message ?? 'sem dados'}`,
      );
      throw new NotFoundException(`Track ${trackId} não encontrada`);
    }

    return Buffer.from(await data.arrayBuffer());
  }

  private async readLocalFile(trackId: string): Promise<Buffer> {
    const filePath = join(process.cwd(), 'audio', `${trackId}.mp3`);
    try {
      return await readFile(filePath);
    } catch {
      throw new NotFoundException(
        `Track ${trackId} não encontrada em ${filePath}`,
      );
    }
  }
}
