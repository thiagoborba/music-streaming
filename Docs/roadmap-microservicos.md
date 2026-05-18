# Roadmap — Microserviços, Containerização e AWS

## Contexto

Evolução do projeto após as Fases 1–3 (CDN redirect, rate limiting, health check). O objetivo é substituir a dependência do Supabase (BaaS) por uma arquitetura própria, containerizada, com microserviços, banco PostgreSQL, S3 para armazenamento de áudio, deploy na AWS free tier, e fundação para multi-tenant e múltiplos frontends.

As Fases 4–6 do roadmap original (`roadmap-fases.md`) são absorvidas e expandidas aqui.

---

## Status das Fases

| # | Fase | Status | Esforço |
|---|------|--------|---------|
| 1 | Redirect CDN | ✅ | — |
| 2 | Rate limiting | ✅ | — |
| 3 | Health check | ✅ | — |
| 4A | Fix requests pendentes (AbortController) | ⏳ | Pequeno |
| 4B | Graceful shutdown | ⏳ | Mínimo |
| 5A | Dockerfile + Docker Compose completo | ⏳ | Médio |
| 5B | PostgreSQL + Prisma (substitui Supabase DB) | ⏳ | Médio |
| 5C | S3/MinIO (substitui Supabase Storage) | ⏳ | Médio |
| 6A | Reestruturar monorepo | ⏳ | Pequeno |
| 6B | Split tracks/stream/events services | ⏳ | Médio |
| 6C | web-bff | ⏳ | Médio |
| 7A | ECR + GitHub Actions CI/CD | ⏳ | Médio |
| 7B | EC2 + RDS + S3 (AWS deploy) | ⏳ | Alto |
| 8 | Multi-tenant foundation | ⏳ | Alto |

---

## Fase 4 — Bug Fix + Graceful Shutdown

### 4A. Fix: requests pendentes no frontend

**Arquivo:** `streaming-web/src/components/WinampPlayer.tsx` (linhas 43–83)

**Root cause:**
- `registerPlay` é função module-level sem `AbortController`. Troca rápida de faixas cria múltiplos POSTs em voo simultâneos para `/events/play`.
- `play()` usa `await audio.play()`. Se `audio.pause()` for chamado enquanto a Promise está pendente (em `selectTrack`), o browser lança `DOMException: The play() request was interrupted`.

**Solução:**
```typescript
// Dentro do componente WinampPlayer:
const registerPlayAbortRef = useRef<AbortController | null>(null);
const playPromiseRef = useRef<Promise<void> | null>(null);

const registerPlay = useCallback(async (trackId: string) => {
  registerPlayAbortRef.current?.abort();
  registerPlayAbortRef.current = new AbortController();
  try {
    await fetch(`${API_URL}/events/play`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ trackId }),
      signal: registerPlayAbortRef.current.signal,
    });
  } catch (e) {
    if (e instanceof DOMException && e.name === 'AbortError') return;
  }
}, []);

const play = useCallback(async (audio: HTMLAudioElement, index: number) => {
  if (!audio.src || audio.src === window.location.href) {
    audio.src = `${API_URL}/stream/${tracks[index].id}`;
  }
  const p = audio.play();
  playPromiseRef.current = p;
  try {
    await p;
    if (playPromiseRef.current === p) {
      setIsPlaying(true);
      registerPlay(tracks[index].id);
    }
  } catch {
    setIsPlaying(false);
  }
}, [tracks, registerPlay]);
```

**Verificação:** DevTools → Network → trocar faixas rapidamente → requests anteriores devem aparecer como `cancelled`, não `pending`. Sem `DOMException` no console.

### 4B. Graceful shutdown

**Arquivo:** `streaming-api/src/main.ts`

```typescript
app.enableShutdownHooks(); // adicionar antes de app.listen()
```

---

## Fase 5 — Containerização + PostgreSQL + S3

### 5A. Dockerfile multi-stage

**Arquivo novo:** `streaming-api/Dockerfile`

```dockerfile
FROM node:20-alpine AS builder
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY . .
RUN npm run build

FROM node:20-alpine
WORKDIR /app
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/node_modules ./node_modules
COPY package*.json ./
EXPOSE 3001
CMD ["node", "dist/main"]
```

### 5B. Docker Compose completo (local dev)

**Arquivo:** `docker-compose.yml` (raiz do projeto)

```yaml
services:
  postgres:
    image: postgres:16-alpine
    environment:
      POSTGRES_DB: music
      POSTGRES_USER: music
      POSTGRES_PASSWORD: music
    volumes: [postgres_data:/var/lib/postgresql/data]
    ports: ["5432:5432"]

  redis:
    image: redis:7-alpine
    volumes: [redis_data:/data]
    ports: ["6379:6379"]

  minio:
    image: minio/minio
    command: server /data --console-address ":9001"
    environment:
      MINIO_ROOT_USER: minioadmin
      MINIO_ROOT_PASSWORD: minioadmin
    volumes: [minio_data:/data]
    ports: ["9000:9000", "9001:9001"]

  api:
    build: ./streaming-api
    ports: ["3001:3001"]
    env_file: ./streaming-api/.env
    depends_on: [postgres, redis, minio]

volumes:
  postgres_data:
  redis_data:
  minio_data:
```

### 5C. PostgreSQL + Prisma (substitui Supabase)

**ORM:** Prisma — substitui o acesso via fetch HTTP ao Supabase.

**Schema:** `streaming-api/prisma/schema.prisma`

```prisma
generator client {
  provider = "prisma-client-js"
}

datasource db {
  provider = "postgresql"
  url      = env("DATABASE_URL")
}

model Track {
  id        String      @id @default(cuid())
  tenantId  String      @default("default")
  title     String
  artist    String
  duration  Int
  genre     String
  s3Key     String
  createdAt DateTime    @default(now())
  events    PlayEvent[]

  @@index([tenantId])
}

model PlayEvent {
  id        String   @id @default(cuid())
  trackId   String
  track     Track    @relation(fields: [trackId], references: [id])
  tenantId  String   @default("default")
  createdAt DateTime @default(now())

  @@index([trackId])
  @@index([tenantId])
}
```

**S3 / MinIO:** `@aws-sdk/client-s3` para gerar presigned URLs (válidas 15min). Em dev usa MinIO com a mesma API do S3.

**Arquivos a alterar:**
- `streaming-api/prisma/schema.prisma` — criar
- `streaming-api/prisma/seed.ts` — migrar `audio/tracks.json` para PostgreSQL
- `streaming-api/src/tracks/tracks.service.ts` — Prisma em vez de fetch Supabase
- `streaming-api/src/stream/stream.service.ts` — presigned URL S3 em vez de 302 Supabase
- `streaming-api/src/events/play-events.processor.ts` — Prisma para contagem de plays

---

## Fase 6 — Split em Microserviços + BFF

### Nova estrutura do monorepo

```
music-streaming/
├── services/
│   ├── tracks-service/    # porta 3001 — CRUD de faixas (PostgreSQL)
│   ├── stream-service/    # porta 3002 — presigned URL S3
│   ├── events-service/    # porta 3003 — play events (PostgreSQL + BullMQ)
│   └── web-bff/           # porta 4000 — BFF para Next.js
├── frontends/
│   ├── web/               # Next.js (atual streaming-web/)
│   └── mobile/            # React Native (futuro)
├── packages/
│   └── shared-types/      # interfaces Track, PlayEvent, etc.
├── infra/
│   ├── docker-compose.yml
│   └── aws/
├── load-test/
└── Docs/
```

### Responsabilidades

| Serviço | Porta | Responsabilidade | Dependências |
|---------|-------|------------------|--------------|
| `tracks-service` | 3001 | CRUD de faixas, metadados | PostgreSQL |
| `stream-service` | 3002 | Gera presigned URL S3 (15min) | S3/MinIO |
| `events-service` | 3003 | Recebe play events, contagem | PostgreSQL + Redis + BullMQ |
| `web-bff` | 4000 | Agrega tudo, expõe ao Next.js | tracks, stream, events |

### BFF — contratos

```
GET  /bff/tracks          → agrega tracks-service + play counts de events-service
GET  /bff/stream/:id      → delega para stream-service → retorna presigned URL
POST /bff/events/play     → delega para events-service (fire-and-forget, 202)
```

Futuramente: `mobile-bff` com payload compacto para React Native.

### Comunicação inter-serviços

- HTTP REST via `ConfigService` (URLs por env var)
- Futuro: SQS/RabbitMQ para eventos assíncronos entre serviços

---

## Fase 7 — Deploy AWS (free tier)

### Recursos

| Recurso | Serviço | Free tier |
|---------|---------|-----------|
| Compute | EC2 t2.micro | 750h/mês (12 meses) |
| Banco | RDS PostgreSQL db.t3.micro | 750h + 20GB (12 meses) |
| Áudio | S3 Standard | 5GB + 20k GET |
| Imagens Docker | ECR | 500MB |
| Redis | Docker no EC2 | (sem ElastiCache free) |

**Estratégia:** EC2 t2.micro rodando todos os serviços via Docker Compose. RDS e S3 externos.

### CI/CD — GitHub Actions

```yaml
# .github/workflows/deploy.yml (resumo)
# 1. Build imagens
# 2. Push para ECR
# 3. SSH no EC2 → docker compose pull && docker compose up -d
```

**Arquivos novos:**
- `.github/workflows/deploy.yml`
- `infra/aws/docker-compose.prod.yml`
- `infra/aws/task-definitions/` (preparação para ECS Fargate futuro)

---

## Fase 8 — Fundação Multi-tenant

O `tenantId` já está no schema Prisma desde a Fase 5 (`@default("default")`).

### Evolução do schema

```prisma
model Tenant {
  id        String   @id @default(cuid())
  slug      String   @unique
  name      String
  plan      String   @default("free")
  tracks    Track[]
  createdAt DateTime @default(now())
}
```

### NestJS — TenantGuard

```typescript
@Injectable()
export class TenantGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const req = context.switchToHttp().getRequest();
    req.tenantId = req.headers['x-tenant-id'] ?? 'default';
    return true;
  }
}
```

### PostgreSQL — Row-Level Security

```sql
ALTER TABLE tracks ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON tracks
  USING (tenant_id = current_setting('app.tenant_id'));
```

### BFF — roteamento por tenant

Header `X-Tenant-ID` ou subdomínio (`tenant1.app.com`) → BFF resolve o tenant → injeta nas chamadas downstream.

---

## Verificação por Fase

```bash
# Fase 4A — DevTools Network
# Trocar faixas rapidamente → requests anteriores: "cancelled", não "pending"
# Console: sem DOMException

# Fase 5
docker compose up -d
curl http://localhost:3001/tracks       # dados do PostgreSQL
curl -I http://localhost:3001/stream/1  # presigned URL S3

# Fase 6
curl http://localhost:4000/bff/tracks   # BFF agrega tracks + play counts

# Fase 7
curl https://<ec2-public-ip>/health     # todos os serviços saudáveis

# Fase 8
curl -H "X-Tenant-ID: acme" http://localhost:4000/bff/tracks
# → retorna apenas faixas do tenant "acme"
```
