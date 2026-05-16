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
}

const CACHE_KEY_ALL = 'tracks:all';

@Injectable()
export class TracksService {
  private readonly logger = new Logger(TracksService.name);
  private readonly tracksJsonUrl = `${process.env.SUPABASE_URL}/storage/v1/object/public/tracks/tracks.json`;

  constructor(@Inject(CACHE_MANAGER) private cacheManager: Cache) {}

  async findAll(): Promise<Track[]> {
    const cached = await this.cacheManager.get<Track[]>(CACHE_KEY_ALL);
    if (cached) return cached;

    const res = await fetch(this.tracksJsonUrl);
    if (!res.ok)
      throw new Error(`Falha ao carregar tracks.json: ${res.status}`);
    const tracks: Track[] = await res.json();

    await this.cacheManager.set(CACHE_KEY_ALL, tracks);
    this.logger.log(
      `${tracks.length} faixas carregadas do Supabase e cacheadas`,
    );
    return tracks;
  }

  async findOne(id: string): Promise<Track | undefined> {
    const cacheKey = `track:${id}`;
    const cached = await this.cacheManager.get<Track>(cacheKey);
    if (cached) return cached;

    const tracks = await this.findAll();
    const track = tracks.find((t) => t.id === id);
    if (track) await this.cacheManager.set(cacheKey, track);
    return track;
  }

  async refresh(): Promise<number> {
    await this.cacheManager.del(CACHE_KEY_ALL);
    const tracks = await this.findAll();
    return tracks.length;
  }
}
