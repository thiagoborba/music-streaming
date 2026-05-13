import {
  Injectable,
  InternalServerErrorException,
  Logger,
  NotFoundException,
  OnModuleInit,
} from '@nestjs/common';
import { createClient, SupabaseClient } from '@supabase/supabase-js';
import { Readable } from 'stream';

/**
 * StreamService — serves audio bytes from Supabase Storage (bucket: `audio`)
 * while preserving HTTP 206 Partial Content semantics for the controller.
 *
 * Strategy: fetch the full MP3 once per process, keep it in-memory (Buffer)
 * keyed by trackId, then slice the requested byte range on each request and
 * pipe it to the response via a Readable stream.
 *
 * Trade-offs:
 *   - Acceptable for ~5MB MP3 samples and a small, fixed catalog (6 tracks).
 *   - Avoids re-downloading the file on every Range request (browsers send
 *     many small Ranges per playback session).
 *   - For large libraries, swap the cache for an LRU and/or use signed-URL
 *     redirects so the CDN handles Range natively.
 */
@Injectable()
export class StreamService implements OnModuleInit {
  private readonly logger = new Logger(StreamService.name);
  private readonly bucket = 'audio';
  private supabase!: SupabaseClient;
  private readonly buffers = new Map<string, Buffer>();
  private readonly inflight = new Map<string, Promise<Buffer>>();

  onModuleInit(): void {
    const url = process.env.SUPABASE_URL;
    const key = process.env.SUPABASE_KEY;
    if (!url || !key) {
      throw new InternalServerErrorException(
        'SUPABASE_URL and SUPABASE_KEY must be set',
      );
    }
    this.supabase = createClient(url, key, {
      auth: { persistSession: false },
    });
  }

  /**
   * Returns the full MP3 bytes for a given trackId, cached in-memory after
   * the first fetch. Coalesces concurrent fetches for the same trackId so
   * a burst of requests during cold start only triggers one download.
   */
  async getTrackBuffer(trackId: string): Promise<Buffer> {
    const cached = this.buffers.get(trackId);
    if (cached) return cached;

    const existing = this.inflight.get(trackId);
    if (existing) return existing;

    const fetchPromise = this.downloadFromSupabase(trackId)
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

  /**
   * Returns a Readable stream over the inclusive byte range [start, end] of
   * the cached buffer. The controller pipes this to the Express response,
   * exactly mirroring the previous `fs.createReadStream({start, end})` flow.
   */
  createRangeStream(buffer: Buffer, start: number, end: number): Readable {
    const slice = buffer.subarray(start, end + 1);
    return Readable.from(slice);
  }

  private async downloadFromSupabase(trackId: string): Promise<Buffer> {
    const objectPath = `${trackId}.mp3`;
    const { data, error } = await this.supabase.storage
      .from(this.bucket)
      .download(objectPath);

    if (error || !data) {
      this.logger.warn(
        `Supabase download failed for ${objectPath}: ${error?.message ?? 'no data'}`,
      );
      throw new NotFoundException(`Track ${trackId} not found`);
    }

    const arrayBuffer = await data.arrayBuffer();
    return Buffer.from(arrayBuffer);
  }
}
