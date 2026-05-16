# Roadmap — Melhorias de Performance e Estabilidade

## Contexto

O backend original era um processo NestJS único que baixava MP3s do Supabase Storage, guardava em memória e servia como proxy de áudio. Sob carga de 400k usuários (1.2M requests), o processo travava. O objetivo das fases abaixo foi tornar o sistema estável independente do volume de acessos, sem depender exclusivamente de escala horizontal.

---

## Status das Fases (2026-05-16)

| # | Fase | Status |
|---|------|--------|
| 1 | Redirect CDN — 302 para Supabase | ✅ Concluída |
| 2 | Rate limiting — `@nestjs/throttler` | ✅ Concluída |
| 3 | Health check — `GET /health` + Redis + Supabase | ✅ Concluída |
| 4 | Graceful shutdown — `app.enableShutdownHooks()` | ⏳ Pendente |
| 5 | Cluster Node.js — 1 worker por CPU core | ⏳ Pendente |
| 6 | Horizontal scaling — Railway replicas | ⏳ Pendente |

---

## Fase 1 — Redirect CDN ✅

**Arquivo:** `streaming-api/src/stream/stream.controller.ts` + `stream.service.ts`

**Antes:** `Browser → NestJS (baixa + serve 27GB) → Browser`
**Depois:** `Browser → NestJS (só autentica) → 302 → Supabase CDN → Browser`

O `StreamController` retorna `302 Redirect` para a URL pública do Supabase em vez de fazer proxy dos bytes:

```ts
// stream.service.ts
getPublicUrl(trackId: string): string | null {
  if (!this.supabaseUrl) return null;
  return `${this.supabaseUrl}/storage/v1/object/public/tracks/${trackId}.mp3`;
}

// stream.controller.ts
@Get(':trackId')
async streamTrack(@Param('trackId') trackId: string, @Res() res: Response): Promise<void> {
  const publicUrl = this.streamService.getPublicUrl(trackId);
  if (publicUrl) {
    res.redirect(302, publicUrl);
    return;
  }
  // Fallback local para dev sem SUPABASE_URL
  const buffer = await this.streamService.getLocalBuffer(trackId);
  // ... serve HTTP 206 com Range headers
}
```

**Impacto:** Node.js sai completamente do caminho de dados de áudio. Range headers e streaming parcial passam a ser responsabilidade do CDN do Supabase (Cloudflare). O load test para de gerar 27GB/3min passando pelo processo.

---

## Fase 2 — Rate Limiting ✅

**Arquivo:** `streaming-api/src/app.module.ts`

`@nestjs/throttler` configurado com limite por IP:

```ts
ThrottlerModule.forRoot([{ ttl: 60_000, limit: 100 }])
```

`@Throttle` customizado no `StreamController` (60 req/min) e no `EventsController`. `TracksController` herda o limite global. Trust proxy habilitado para leitura correta de IP real no Railway (header `X-Forwarded-For`).

---

## Fase 3 — Health Check ✅

**Arquivo:** `streaming-api/src/health/health.controller.ts`

`GET /health` verifica:
1. Redis acessível — `cache.set` + `cache.get` com TTL 5s
2. Supabase Storage acessível — `HEAD` no `tracks.json` do bucket

Retorna `200 { status: "ok", redis: true, supabase: true }` ou `503` se algum falhar.

Configurado em `railway.json` como healthcheck path. `SkipThrottle()` aplicado para não consumir cota do rate limiter.

---

## Fase 4 — Graceful Shutdown ⏳

**Prioridade: alta | Esforço: mínimo (1 linha)**

**Arquivo:** `streaming-api/src/main.ts`

**Problema:** Sem graceful shutdown, o Railway mata o processo abruptamente em deploys e restarts. Requisições em andamento recebem conexão fechada — 502 visível ao usuário.

```ts
async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  app.enableShutdownHooks(); // ← adicionar
  await app.listen(process.env.PORT ?? 3001);
}
```

Quando o Railway envia `SIGTERM`, o NestJS aguarda as requisições ativas terminarem antes de encerrar. Com Fase 1 concluída (redirect 302), o shutdown é praticamente instantâneo — não há bytes de áudio em trânsito pelo processo.

---

## Fase 5 — Cluster Node.js ⏳

**Prioridade: média | Esforço: médio**

**Pré-requisito:** Fase 1 deve estar concluída. Workers de cluster não compartilham memória — o buffer cache in-memory quebraria sem o redirect.

**Arquivo novo:** `streaming-api/src/cluster.ts`

```ts
import cluster from 'cluster';
import os from 'os';

export function clusterize(callback: () => void): void {
  if (cluster.isPrimary) {
    const cpus = os.cpus().length;
    console.log(`Primary ${process.pid} — iniciando ${cpus} workers`);
    for (let i = 0; i < cpus; i++) cluster.fork();
    cluster.on('exit', (worker) => {
      console.warn(`Worker ${worker.process.pid} morreu — reiniciando`);
      cluster.fork();
    });
  } else {
    callback();
  }
}
```

**Modificar `main.ts`:**
```ts
import { clusterize } from './cluster';

clusterize(async () => {
  const app = await NestFactory.create(AppModule);
  app.enableShutdownHooks();
  await app.listen(process.env.PORT ?? 3001);
});
```

**Impacto esperado no k6 (500 VUs):** p95 deve cair de ~500ms para ~150ms com 4 workers (Railway Hobby tem 4 vCPUs).

---

## Fase 6 — Horizontal Scaling ⏳

**Prioridade: baixa | Esforço: médio (infraestrutura)**

**Pré-requisito:** Fases 1 e 5 concluídas — backend deve ser stateless.

Após Fase 1 (sem buffer in-memory), o backend é stateless. Railway replicas + Redis compartilhado funciona sem mudança de código — exceto o Throttler, que precisa de Redis como storage para contar por IP entre réplicas:

```ts
// app.module.ts
ThrottlerModule.forRootAsync({
  useFactory: () => ({
    throttlers: [{ ttl: 60_000, limit: 100 }],
    storage: new ThrottlerStorageRedisService(process.env.REDIS_URL),
  }),
}),
```

**O que Railway precisa:**
- Settings → Replicas: 2 ou mais
- `REDIS_URL` já é compartilhado — sem mudança adicional
- BullMQ já funciona com múltiplos workers no mesmo Redis

**Verificação:** k6 com `constant-arrival-rate` apontando para o load balancer do Railway para medir throughput real distribuído.

---

## Ordem de Execução

| # | Fase | Esforço | Impacto |
|---|------|---------|---------|
| 1 | Redirect CDN | Baixo | **Crítico** — elimina 27GB/3min pelo Node.js |
| 2 | Rate limiting | Baixo | Alto — protege contra abuso por IP |
| 3 | Health check | Médio | Alto — Railway roteia só para instâncias saudáveis |
| 4 | Graceful shutdown | Mínimo | Médio — deploys sem downtime |
| 5 | Cluster Node.js | Médio | Alto — usa CPU completa sem infra extra |
| 6 | Horizontal scaling | Infra | Alto — escala ilimitada |

---

## Verificação Final

```bash
# Fase 1
curl -I http://localhost:3001/stream/1
# → HTTP/1.1 302 Found
# → Location: https://*.supabase.co/storage/v1/object/public/tracks/1.mp3

# Fase 3
curl http://localhost:3001/health
# → { "status": "ok", "redis": true, "supabase": true }

# Fases 5 + 6
k6 run dist/concurrent-listeners.js
# → p95 < 200ms com 500 VUs, sem erros de infra
```
