import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';

/**
 * CORS allowlist:
 *   - `http://localhost:3000` for local dev.
 *   - `CORS_ORIGIN` (comma-separated) for production — set this on Railway to
 *     the Vercel frontend URL, e.g. `https://music-streaming.vercel.app`.
 *     Preview deploys on Vercel get unique URLs; either add each one or use a
 *     wildcard regex by extending this list to RegExp entries.
 */
function buildCorsOrigins(): (string | RegExp)[] {
  const fromEnv = (process.env.CORS_ORIGIN ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  return ['http://localhost:3000', ...fromEnv];
}

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  app.enableCors({ origin: buildCorsOrigins() });
  await app.listen(process.env.PORT ?? 3001, '0.0.0.0');
}
bootstrap();
