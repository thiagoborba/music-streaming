import { readFile } from 'fs/promises';
import { join } from 'path';
import { Injectable, Logger } from '@nestjs/common';
import type { Cache } from 'cache-manager';
import { Inject } from '@nestjs/common';
import { CACHE_MANAGER } from '@nestjs/cache-manager';

export interface Track {
  id: string;
  title: string;
  artist: string;
  duration: number;
  genre: string;
  playCount: number;
}

const CACHE_KEY_ALL = 'tracks:all';

@Injectable()
export class TracksService {
  private readonly logger = new Logger(TracksService.name);
  private readonly tracksJsonUrl: string | null = process.env.SUPABASE_URL
    ? `${process.env.SUPABASE_URL}/storage/v1/object/public/tracks/tracks.json`
    : null;

  constructor(@Inject(CACHE_MANAGER) private cacheManager: Cache) {}

  private async loadLocal(): Promise<Omit<Track, 'playCount'>[]> {
    const file = join(process.cwd(), 'audio', 'tracks.json');
    const raw = await readFile(file, 'utf-8');
    return JSON.parse(raw) as Omit<Track, 'playCount'>[];
  }

  async findAll(): Promise<Track[]> {
    type RawTrack = Omit<Track, 'playCount'>;

    let raw = await this.cacheManager.get<RawTrack[]>(CACHE_KEY_ALL);
    if (!raw) {
      if (this.tracksJsonUrl) {
        const res = await fetch(this.tracksJsonUrl);
        if (!res.ok)
          throw new Error(`Falha ao carregar tracks.json: ${res.status}`);
        raw = (await res.json()) as RawTrack[];
      } else {
        this.logger.warn(
          'SUPABASE_URL não definida — usando tracks.json local',
        );
        raw = await this.loadLocal();
      }
      await this.cacheManager.set(CACHE_KEY_ALL, raw);
      this.logger.log(`${raw.length} faixas carregadas e cacheadas`);
    }

    return Promise.all(
      raw.map(async (t) => ({
        ...t,
        playCount: (await this.cacheManager.get<number>(`plays:${t.id}`)) ?? 0,
      })),
    );
  }

  async findOne(id: string): Promise<Track | undefined> {
    const tracks = await this.findAll();
    return tracks.find((t) => t.id === id);
  }

  async refresh(): Promise<number> {
    await this.cacheManager.del(CACHE_KEY_ALL);
    const tracks = await this.findAll();
    return tracks.length;
  }
}
