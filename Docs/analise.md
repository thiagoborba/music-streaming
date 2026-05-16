# Análise Técnica — music-streaming

Projeto de portfólio demonstrando streaming de áudio em alta concorrência com NestJS, Next.js 16, Redis e BullMQ. Este documento cobre arquitetura, conceitos demonstrados, oportunidades de melhoria de performance, SEO e acessibilidade.

---

## 1. Arquitetura

### Visão geral

```
Browser
  │
  ▼
Vercel (Next.js 16 — Turbopack)          porta 3000
  │  SSR dinâmico em /
  │  GET /tracks → AbortSignal.timeout(5s)
  │
  ▼
Railway (NestJS)                          porta 3001
  ├── GET  /tracks          → Redis cache (TTL 1h)
  ├── GET  /stream/:id      → HTTP 206 (Range headers)
  ├── POST /events/play     → BullMQ queue (HTTP 202)
  └── GET  /health          → Redis + Supabase ping
        │               │
        ▼               ▼
      Redis         Supabase Storage
   (cache + filas)  (tracks.json + *.mp3)
```

### Rendering strategy

| Rota | Strategy | Motivo |
|------|----------|--------|
| `/` | Dynamic (SSR por requisição) | `cache: 'no-store'` — playlist sempre atualizada |
| `/_not-found` | Static (build time) | Sem dados dinâmicos |

### Ambientes

| Aspecto | Dev Local | Produção |
|---------|-----------|----------|
| MP3 source | `audio/*.mp3` (local) | Supabase Storage |
| tracks.json | `audio/tracks.json` (local) | Supabase Storage |
| Redis | `localhost:6379` | Railway add-on (`REDIS_URL`) |
| CORS | desabilitado | `CORS_ORIGIN` env var |
| Frontend | `http://localhost:3000` | Vercel (music-streaming-red.vercel.app) |
| Backend | `http://localhost:3001` | Railway (music-streaming-production.up.railway.app) |

---

## 2. Conceitos Demonstrados

### HTTP 206 Partial Content

O endpoint `GET /stream/:id` implementa streaming byte-range completo:

```
Browser: Range: bytes=0-65535
NestJS:  206 Partial Content
         Content-Range: bytes 0-65535/12071706
         Accept-Ranges: bytes
```

O elemento `<audio preload="none">` do browser negocia automaticamente os chunks — ele solicita apenas o trecho necessário para reprodução imediata e continua buscando em paralelo. Isso é idêntico ao comportamento de `fs.createReadStream` com `{ start, end }`.

**Trade-off atual:** o buffer completo do MP3 é carregado em memória no primeiro acesso (`Readable.from(buffer.subarray(...))`). Aceitável para 6–10 faixas pequenas; para catálogos maiores, trocar por redirect 302 para URL assinada do Supabase ou LRU cache com limite de bytes.

### Redis — Cache-Aside Pattern

```
1ª requisição (miss):
  GET /tracks → Redis.get('tracks:all') → null
              → fetch Supabase tracks.json
              → Redis.set('tracks:all', data, TTL=3600)
              → responde com dados

2ª+ requisições (hit):
  GET /tracks → Redis.get('tracks:all') → data
              → responde sem tocar no Supabase
```

Invalidação explícita via `POST /tracks/refresh` — útil após upload de nova faixa.

Play counts ficam em chaves individuais `plays:{id}` (sem TTL), incrementados pelo BullMQ processor.

### BullMQ — Processamento Assíncrono de Eventos

```
Browser → POST /events/play { trackId }
                │
                ▼ HTTP 202 (imediato — não bloqueia player)
        BullMQ Queue 'play-events'
                │
                ▼ (assíncrono)
        PlayEventsProcessor.handlePlay()
          → Redis.get('plays:{id}')
          → Redis.set('plays:{id}', count + 1, 0)  ← sem TTL
```

O retorno imediato (202) garante que latência de registro não afeta UX do player.

### Teste de Carga — 500 VUs Simultâneos

Threshold configurado: **p95 < 500ms** com 500 usuários simultâneos.

O Redis absorve os 500 hits em ~0.1ms cada (in-memory, sem I/O de banco) após o primeiro cache warm-up. O gargalo real muda para o NestJS event loop e throughput do Railway — daí a importância do k6 medir p95 e não só média.

---

## 3. Melhorias de Performance

### 3.1 Cache-Control no GET /tracks (baixa complexidade)

**Problema:** A resposta de `/tracks` não tem `Cache-Control`. CDNs e browsers tratam como não-cacheável.

**Correção em `tracks.controller.ts`:**
```typescript
@Get()
async findAll(@Res({ passthrough: true }) res: Response) {
  res.setHeader('Cache-Control', 'public, max-age=3600, stale-while-revalidate=60');
  return this.tracksService.findAll();
}
```

**Impacto:** Clientes que recarregam a página não fazem nova requisição ao Railway por 1h. Alinhado com o TTL do Redis.

### 3.2 ETag + 304 no streaming HTTP 206 (complexidade média)

**Problema:** A cada play de uma faixa já ouvida, o browser re-faz os range requests. Sem `ETag`, não há como validar cache condicional.

**Correção em `stream.controller.ts`:**
```typescript
const etag = `"${trackId}-${buffer.length}"`;
if (req.headers['if-none-match'] === etag) {
  return res.status(304).end();
}
res.setHeader('ETag', etag);
```

**Impacto:** Browser cached tracks → 0 bytes transferidos nos plays subsequentes.

### 3.3 Vary: Range no streaming (baixa complexidade)

**Problema:** CDNs podem cachear incorretamente respostas parciais sem `Vary: Range`.

**Correção:** Adicionar `res.setHeader('Vary', 'Range')` junto com os outros headers de streaming.

### 3.4 Security Headers no Next.js (baixa complexidade)

**Problema:** `next.config.ts` não define headers de segurança — ausentes em todas as respostas do frontend.

**Correção em `next.config.ts`:**
```typescript
const securityHeaders = [
  { key: 'X-Content-Type-Options', value: 'nosniff' },
  { key: 'X-Frame-Options', value: 'DENY' },
  { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
  { key: 'Permissions-Policy', value: 'camera=(), microphone=()' },
];

const nextConfig: NextConfig = {
  async headers() {
    return [{ source: '/(.*)', headers: securityHeaders }];
  },
  turbopack: { root: path.resolve(__dirname) },
};
```

**Impacto:** Core Web Vitals não são diretamente afetados, mas Lighthouse Security audit passa. Impede clickjacking e MIME sniffing.

### 3.5 LRU Cache para Buffers de MP3 (complexidade média)

**Problema atual:** `StreamService` carrega o buffer completo do Supabase na primeira requisição e mantém em memória sem limite. Com 10 faixas de ~10MB cada, isso é ~100MB fixos — OK por ora, mas não escalável.

**Abordagem futura:** Substituir por LRU com limite de bytes (ex: `lru-cache` com `maxSize: 200_000_000`). Faixas mais tocadas ficam em memória; faixas raras são evicted e re-baixadas quando necessário.

### 3.6 Turbopack FileSystem Cache (baixa complexidade)

A partir do Next.js 16.1, filesystem caching é habilitado por padrão em dev. Para builds de produção (CI/CD), adicionar:

```typescript
experimental: {
  turbopackFileSystemCacheForBuild: true,
}
```

**Impacto em CI:** Builds subsequentes do mesmo código ficam ~3–5× mais rápidos.

---

## 4. SEO

O frontend atual tem metadata mínima. Comparação com o padrão do portfólio (`portifolio-front/`):

| Campo | Estado Atual | Recomendado |
|-------|-------------|-------------|
| `<title>` | "StreamingDemo" | "StreamingDemo — NestJS · Redis · BullMQ · Next.js" |
| `description` | "NestJS + Next.js • Redis • BullMQ • Supabase" | Expandir com keywords naturais |
| `metadataBase` | ❌ ausente | `new URL('https://music-streaming-red.vercel.app')` |
| Open Graph | ❌ ausente | `og:title`, `og:description`, `og:image` (1200×630) |
| Twitter Card | ❌ ausente | `twitter:card: 'summary_large_image'` |
| JSON-LD | ❌ ausente | Schema.org `SoftwareApplication` |
| `robots` | default | `{ index: true, follow: true }` |
| `canonical` | ❌ ausente | Derivado de `metadataBase` automaticamente |
| `keywords` | ❌ ausente | "nestjs audio streaming, redis cache, bullmq queue" |

**Exemplo completo para `layout.tsx`:**
```typescript
export const metadata: Metadata = {
  metadataBase: new URL('https://music-streaming-red.vercel.app'),
  title: 'StreamingDemo — NestJS · Redis · BullMQ',
  description:
    'Projeto de portfólio demonstrando streaming de áudio com HTTP 206, cache Redis, filas BullMQ e teste de carga com 500 VUs simultâneos.',
  keywords: ['nestjs', 'audio streaming', 'redis cache', 'bullmq', 'next.js', 'http 206'],
  authors: [{ name: 'Thiago Borba' }],
  openGraph: {
    title: 'StreamingDemo — NestJS · Redis · BullMQ',
    description: 'Streaming de áudio com alta concorrência.',
    url: 'https://music-streaming-red.vercel.app',
    type: 'website',
  },
  twitter: { card: 'summary_large_image' },
  robots: { index: true, follow: true },
};
```

**JSON-LD (Schema.org SoftwareApplication)** — adicionar em `layout.tsx` via `<script type="application/ld+json">`:
```json
{
  "@context": "https://schema.org",
  "@type": "SoftwareApplication",
  "name": "StreamingDemo",
  "applicationCategory": "MultimediaApplication",
  "description": "Projeto de portfólio — streaming de áudio com NestJS, Redis e BullMQ",
  "url": "https://music-streaming-red.vercel.app",
  "author": { "@type": "Person", "name": "Thiago Borba" }
}
```

---

## 5. Acessibilidade

### Estado atual

O player Winamp implementa vários padrões corretos:

| Elemento | Estado |
|----------|--------|
| `<html lang="pt-br">` | ✅ Correto |
| `aria-label` nos botões (play, prev, next, stop) | ✅ Implementado |
| `aria-label` no input de progresso | ✅ Implementado |
| `aria-label` no input de volume | ✅ Implementado |
| `role="button"` + `tabIndex={0}` nos itens da playlist | ✅ Implementado |
| `aria-current` no item ativo | ✅ Implementado |
| `onKeyDown` Enter na playlist | ✅ Implementado |

### Lacunas identificadas

| Elemento | Problema | Correção |
|----------|----------|----------|
| `<input type="range">` progress | Sem `aria-valuetext` — leitores de tela anunciam "50" sem contexto | Adicionar `aria-valuetext={fmt(currentTime)}` |
| `<audio>` element | Sem foco gerenciado ao trocar faixa | Adicionar `aria-live="polite"` em um `<span>` que anuncia o nome da faixa ao trocar |
| Barra de buffer (visual) | Puramente decorativa, sem equivalente textual | Adicionar `aria-label` no input de progresso com valor completo: `${fmt(currentTime)} de ${fmt(duration)}` |
| Título do player | Decorativo (STREAMINGDEMO v1.0) | `aria-hidden="true"` na title bar evita leitura desnecessária |

### Contraste de cores (WCAG AA — 4.5:1)

O tema Y2K usa verde `#a8d400` em fundo `#1a1a1a`:
- Ratio: **~7.8:1** ✅ Passa em WCAG AA e AAA
- Texto menor (5px, playlist) pode ser problemático apenas para tipografia em tamanho real, mas a fonte pixelada é estilística e não informacional crítica

---

## 6. Oportunidades Futuras

| Feature | Valor | Esforço |
|---------|-------|---------|
| Swagger/OpenAPI via `@nestjs/swagger` | Documentação interativa da API para portfólio | Baixo |
| Paginação em GET /tracks (`?limit=&offset=`) | Escalabilidade para catálogos maiores | Baixo |
| Testes unitários `TracksService` (mock `cacheManager`) | Cobertura de testes para portfólio | Médio |
| Redirect 302 para URL assinada (Supabase) em vez de buffer in-memory | Elimina consumo de RAM no Railway | Médio |
| `og:image` gerado com `@vercel/og` | Preview rico em links sociais | Médio |
| Modo offline / Service Worker | Player continua funcionando sem rede | Alto |

---

## 7. Próximas Fases — Roadmap de Implementação

### Estado atual (2026-05-16)

**Lighthouse (desktop, última medição):**

| Métrica | Score |
|---------|-------|
| Performance | 74 |
| Acessibilidade | 94 |
| Boas práticas | 96 |
| SEO | 100 |

**Infraestrutura em produção:**
- Vercel (frontend): https://music-streaming-red.vercel.app — ✅ online
- Railway (backend): https://music-streaming-production.up.railway.app — ⚠️ trial expirado
- Supabase Storage: bucket `tracks` com 10 MP3s + `tracks.json` — ✅ online

**Fases backend — status:**

| Fase | Descrição | Status |
|------|-----------|--------|
| 1 | Redirect CDN — `GET /stream/:id` retorna 302 para Supabase | ✅ Concluída |
| 2 | Rate limiting — `@nestjs/throttler`, 60 req/min por IP | ✅ Concluída |
| 3 | Health check — `GET /health` verifica Redis + Supabase | ✅ Concluída |
| 4 | Graceful shutdown — `app.enableShutdownHooks()` | ⏳ Pendente |
| 5 | Cluster Node.js — 1 worker por CPU core | ⏳ Pendente |
| 6 | Horizontal scaling — Railway replicas | ⏳ Pendente |

---

### Fase 4 — Graceful Shutdown

**Prioridade: alta | Esforço: mínimo (1 linha)**

**Problema:** Sem graceful shutdown, o Railway mata o processo abruptamente em deploys e restarts. Requisições em andamento (streaming de áudio em progresso) recebem conexão fechada, resultando em 502 visível ao usuário.

**Implementação em `streaming-api/src/main.ts`:**
```typescript
async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  app.enableShutdownHooks(); // ← adicionar esta linha
  // ... resto do setup
  await app.listen(process.env.PORT ?? 3001);
}
```

**O que acontece:** Quando o Railway envia `SIGTERM`, o NestJS aguarda as requisições ativas terminarem (até o timeout do proxy) antes de encerrar o processo. O Redirect 302 (Fase 1) já eliminou o streaming em processo, então o shutdown é praticamente instantâneo.

---

### Fase 5 — Cluster Node.js

**Prioridade: média | Esforço: médio**

**Contexto:** Node.js é single-threaded por design. Um Railway instance tem múltiplos CPU cores disponíveis; sem cluster, apenas 1 core é usado.

**Pré-requisito obrigatório:** Fase 1 (redirect 302) deve estar concluída. O cluster não pode ser usado com buffer in-memory porque cada worker teria sua própria cópia — inconsistência total. Com redirect, cada worker é stateless.

**Implementação — criar `streaming-api/src/cluster.ts`:**
```typescript
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
```typescript
import { clusterize } from './cluster';

clusterize(async () => {
  const app = await NestFactory.create(AppModule);
  app.enableShutdownHooks();
  await app.listen(process.env.PORT ?? 3001);
});
```

**Impacto esperado no k6 (500 VUs):** p95 deve cair de ~500ms para ~150ms com 4 workers (Railway Hobby tem 4 vCPUs).

---

### Fase 6 — Horizontal Scaling

**Prioridade: baixa | Esforço: médio (infraestrutura)**

**Contexto:** Railway permite múltiplas réplicas do mesmo serviço. Redis e BullMQ já estão prontos para multi-instância (são shared state externo).

**O que precisaria ser configurado:**
- Railway Settings → Replicas: 2 ou mais
- `REDIS_URL` já é compartilhado — sem mudança de código
- BullMQ é nativo multi-worker — sem mudança de código
- O ThrottlerGuard precisa de Redis como storage para contar corretamente por IP entre réplicas:

```typescript
// app.module.ts — substituir armazenamento in-memory do Throttler por Redis
ThrottlerModule.forRootAsync({
  useFactory: () => ({
    throttlers: [{ ttl: 60_000, limit: 100 }],
    storage: new ThrottlerStorageRedisService(process.env.REDIS_URL),
  }),
}),
```

**Pré-requisito:** Fase 5 (cluster) já extrai o máximo de um único nó — só faz sentido escalar horizontalmente após isso.

---

### Implementações Frontend Priorizadas

Em ordem de impacto/esforço:

#### F1 — Security Headers (esforço: mínimo)

Arquivo: `streaming-web/next.config.ts`

```typescript
async headers() {
  return [{
    source: '/(.*)',
    headers: [
      { key: 'X-Content-Type-Options', value: 'nosniff' },
      { key: 'X-Frame-Options', value: 'DENY' },
      { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
      { key: 'Permissions-Policy', value: 'camera=(), microphone=()' },
    ],
  }];
},
```

#### F2 — SEO Completo (esforço: baixo)

Arquivo: `streaming-web/src/app/layout.tsx`

Adicionar `metadataBase`, Open Graph, Twitter Card e JSON-LD Schema.org — exemplos completos na seção 4 deste documento.

#### F3 — Acessibilidade: aria-valuetext + aria-live (esforço: baixo)

Arquivo: `streaming-web/src/components/WinampPlayer.tsx`

```tsx
{/* No input de progresso */}
aria-valuetext={`${fmt(currentTime)} de ${fmt(displayDuration)}`}

{/* Span oculto que anuncia troca de faixa para leitores de tela */}
<span aria-live="polite" className="sr-only">
  {currentTrack ? `Tocando: ${currentTrack.title} por ${currentTrack.artist}` : ''}
</span>
```

#### F4 — og:image com @vercel/og (esforço: médio)

Criar `streaming-web/src/app/opengraph-image.tsx`:
```tsx
import { ImageResponse } from 'next/og';

export const runtime = 'edge';
export const size = { width: 1200, height: 630 };

export default function OGImage() {
  return new ImageResponse(
    <div style={{ background: '#000', color: '#a8d400', /* estilo Winamp */ }}>
      <h1>StreamingDemo</h1>
      <p>NestJS · Redis · BullMQ · Next.js 16</p>
    </div>
  );
}
```

---

### Implementações de API Priorizadas

#### A1 — Cache-Control no GET /tracks (esforço: mínimo)

Detalhe completo na seção 3.1 deste documento.

#### A2 — ETag + Vary: Range no streaming (esforço: baixo)

Detalhes completos nas seções 3.2 e 3.3 deste documento.

#### A3 — Swagger/OpenAPI (esforço: baixo)

```bash
npm install @nestjs/swagger
```

Em `main.ts`:
```typescript
const config = new DocumentBuilder()
  .setTitle('music-streaming API')
  .setDescription('HTTP 206 streaming · Redis cache · BullMQ events')
  .setVersion('1.0')
  .build();
SwaggerModule.setup('api', app, SwaggerModule.createDocument(app, config));
```

Expõe documentação interativa em `GET /api` — diferencial de portfólio.

#### A4 — Testes unitários TracksService (esforço: médio)

```typescript
// tracks.service.spec.ts
describe('TracksService', () => {
  it('retorna do cache quando disponível', async () => {
    mockCacheManager.get.mockResolvedValue(mockRaw);
    const result = await service.findAll();
    expect(result).toHaveLength(mockRaw.length);
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it('faz fetch e cacheia no miss', async () => {
    mockCacheManager.get.mockResolvedValue(null);
    global.fetch = jest.fn().mockResolvedValue({ ok: true, json: () => mockRaw });
    await service.findAll();
    expect(mockCacheManager.set).toHaveBeenCalledWith('tracks:all', mockRaw);
  });
});
```

---

### Observabilidade (fase futura)

Quando o Railway for reativado ou migrado, adicionar:

| Ferramenta | Finalidade |
|------------|-----------|
| `@nestjs/terminus` (já tem) | Health checks padronizados |
| Structured logging com `pino` | Logs em JSON → Railway Log Drain |
| `@opentelemetry/sdk-node` | Traces distribuídos (latência por endpoint) |
| Prometheus endpoint + Grafana | Métricas de p95, throughput e erro rate no tempo |

O k6 já gera p95 para snapshots pontuais — observabilidade contínua fecha o ciclo para produção real.

---

### Resumo de Prioridades para Próxima Sessão

| # | Tarefa | Arquivo | Esforço |
|---|--------|---------|---------|
| 1 | Graceful shutdown | `streaming-api/src/main.ts` | 1 linha |
| 2 | Security headers | `streaming-web/next.config.ts` | 10 linhas |
| 3 | SEO completo (metadata + JSON-LD) | `streaming-web/src/app/layout.tsx` | 30 linhas |
| 4 | aria-valuetext + aria-live | `streaming-web/src/components/WinampPlayer.tsx` | 10 linhas |
| 5 | Cache-Control + ETag + Vary | `streaming-api/src/stream/stream.controller.ts` | 20 linhas |
| 6 | Swagger/OpenAPI | `streaming-api/src/main.ts` + decorators | 30 linhas |
| 7 | Cluster Node.js | `streaming-api/src/cluster.ts` + `main.ts` | 40 linhas |
| 8 | Testes unitários TracksService | `streaming-api/src/tracks/tracks.service.spec.ts` | médio |
| 9 | Horizontal scaling + Throttler Redis storage | Railway + `app.module.ts` | médio |
| 10 | og:image @vercel/og | `streaming-web/src/app/opengraph-image.tsx` | médio |
