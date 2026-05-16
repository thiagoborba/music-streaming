import { Injectable } from '@nestjs/common';
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

const TRACKS_SEED: Track[] = [
  {
    id: '1',
    title: 'Like a Stone',
    artist: 'Audioslave',
    duration: 294,
    genre: 'Rock',
  },
  {
    id: '2',
    title: 'Black',
    artist: 'Pearl Jam',
    duration: 346,
    genre: 'Rock',
  },
  {
    id: '3',
    title: 'Toxicity',
    artist: 'System of a Down',
    duration: 213,
    genre: 'Metal',
  },
  {
    id: '4',
    title: 'Time',
    artist: 'Pink Floyd',
    duration: 413,
    genre: 'Rock',
  },
  {
    id: '5',
    title: 'Hotel California',
    artist: 'Eagles',
    duration: 391,
    genre: 'Rock',
  },
  {
    id: '6',
    title: 'The Great Gig in the Sky',
    artist: 'Pink Floyd',
    duration: 284,
    genre: 'Rock',
  },
  {
    id: '7',
    title: 'Patience',
    artist: "Guns N' Roses",
    duration: 358,
    genre: 'Rock',
  },
];

@Injectable()
export class TracksService {
  constructor(@Inject(CACHE_MANAGER) private cacheManager: Cache) {}

  async findAll(): Promise<Track[]> {
    const cacheKey = 'tracks:all';
    const cached = await this.cacheManager.get<Track[]>(cacheKey);
    if (cached) return cached;

    await this.cacheManager.set(cacheKey, TRACKS_SEED);
    return TRACKS_SEED;
  }

  async findOne(id: string): Promise<Track | undefined> {
    const cacheKey = `track:${id}`;
    const cached = await this.cacheManager.get<Track>(cacheKey);
    if (cached) return cached;

    const track = TRACKS_SEED.find((t) => t.id === id);
    if (track) await this.cacheManager.set(cacheKey, track);
    return track;
  }
}
