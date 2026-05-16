import { Controller, Get, Inject, HttpException } from '@nestjs/common';
import { CACHE_MANAGER } from '@nestjs/cache-manager';
import { SkipThrottle } from '@nestjs/throttler';
import type { Cache } from 'cache-manager';

@SkipThrottle()
@Controller('health')
export class HealthController {
  constructor(@Inject(CACHE_MANAGER) private cache: Cache) {}

  @Get()
  async check(): Promise<{
    status: string;
    redis: boolean;
    supabase: boolean;
  }> {
    const [redis, supabase] = await Promise.all([
      this.checkRedis(),
      this.checkSupabase(),
    ]);

    if (!redis || !supabase) {
      throw new HttpException({ status: 'error', redis, supabase }, 503);
    }

    return { status: 'ok', redis, supabase };
  }

  private async checkRedis(): Promise<boolean> {
    try {
      await this.cache.set('health:ping', '1', 5);
      return (await this.cache.get('health:ping')) === '1';
    } catch {
      return false;
    }
  }

  private async checkSupabase(): Promise<boolean> {
    const url = process.env.SUPABASE_URL;
    if (!url) return true;
    try {
      const res = await fetch(
        `${url}/storage/v1/object/public/tracks/tracks.json`,
        { method: 'HEAD' },
      );
      return res.ok;
    } catch {
      return false;
    }
  }
}
