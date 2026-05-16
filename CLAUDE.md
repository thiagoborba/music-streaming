# music-streaming

Projeto de portfólio demonstrando streaming de áudio com alta concorrência. Construído para entrevistas técnicas sobre escalabilidade.

## Estrutura

```
music-streaming/
├── streaming-api/   # NestJS backend — porta 3001 (Railway em prod)
├── streaming-web/   # Next.js frontend — porta 3000 (Vercel em prod)
└── load-test/       # k6 TypeScript — testes de carga
```

## Conceitos demonstrados
- **HTTP 206 Partial Content** — streaming de áudio por chunks com `Range` headers
- **Redis cache** — metadados de faixas com TTL de 1h (via `@nestjs/cache-manager`)
- **BullMQ** — processamento assíncrono de eventos de play (via `@nestjs/bull`)
- **500 VUs simultâneos** — teste de carga com k6, threshold p95 < 500ms

## Comandos

### Backend (`streaming-api/`)
```bash
npm run start:dev   # NestJS watch mode — porta 3001
npm run build       # Compilar TypeScript
npm run start:prod  # Produção
```

**Requer Redis rodando:** `npm run infra:up` (Docker Compose — ver seção Infraestrutura abaixo)

### Frontend (`streaming-web/`)
```bash
npm run dev    # Next.js dev — porta 3000
npm run build
npm start
```

### Infraestrutura local (`docker-compose.yml` na raiz)

```bash
# De dentro de streaming-api/ (ou com -f ../docker-compose.yml de qualquer lugar)
npm run infra:up    # sobe Redis em background
npm run infra:down  # para e remove o container (dados preservados no volume)
npm run infra:logs  # acompanha logs do Redis em tempo real

# Reset completo (apaga o volume redis_data)
docker compose down -v

# Ver o que está rodando
docker ps

# Matar container à força (sem docker compose)
docker rm -f music-streaming-redis
```

**Nota WSL2:** O daemon Docker não inicia automaticamente ao reabrir o terminal. Rodar `sudo service docker start` antes de usar qualquer comando docker.

### Load Test (`load-test/`)
```bash
npm install
npm run build   # webpack → dist/concurrent-listeners.js
k6 run dist/concurrent-listeners.js
```

**Requer k6 instalado:** `sudo apt install k6` ou `brew install k6`

## Variáveis de ambiente

### Backend (`streaming-api/`)

Veja `streaming-api/.env.example`. Em dev local nenhuma é obrigatória, mas o `StreamService` agora lê os MP3s do **Supabase Storage**, então `SUPABASE_URL` e `SUPABASE_KEY` precisam estar setados para `/stream/:id` funcionar.

| Variável        | Obrigatório | Onde                  | Descrição                                                                |
|-----------------|-------------|-----------------------|--------------------------------------------------------------------------|
| `SUPABASE_URL`  | sim         | Railway + dev         | URL do projeto Supabase (`https://<ref>.supabase.co`)                    |
| `SUPABASE_KEY`  | sim         | Railway + dev         | Anon key pública (bucket `tracks` é público)                             |
| `REDIS_URL`     | prod        | Railway (automático)  | Injetado pelo add-on Redis. Em dev cai para `localhost:6379`             |
| `CORS_ORIGIN`   | prod        | Railway               | Origens permitidas, separadas por vírgula. Ex.: `https://<app>.vercel.app` |
| `PORT`          | não         | Railway (automático)  | Em dev cai para `3001`                                                   |

### Frontend (`streaming-web/.env.local`)

| Variável               | Descrição                                              |
|------------------------|--------------------------------------------------------|
| `NEXT_PUBLIC_API_URL`  | URL pública do backend. Em prod: `https://<app>.up.railway.app` |

## Áudio de amostra

Os 6 MP3s (`1.mp3` a `6.mp3`) vivem em duas localizações:
- **Dev local**: `streaming-api/audio/` (ignorado pelo deploy do Railway)
- **Produção**: bucket público `tracks` no Supabase Storage

Para subir manualmente: Supabase Dashboard → Storage → criar bucket `tracks` (público) → upload dos 6 arquivos com os mesmos nomes.

## Arquitetura

### Fluxo de streaming (produção)
```
Browser → GET /stream/:id (Range: bytes=X-Y)
NestJS StreamController → StreamService.getTrackBuffer(id)
  └── 1ª vez: Supabase Storage .download() → Buffer em memória
  └── 2ª+:    Buffer já cacheado in-process
→ Readable.from(buffer.subarray(start, end+1)).pipe(response) → HTTP 206
```

O comportamento de Range/206 é idêntico ao do `fs.createReadStream` original — só a origem dos bytes mudou. Trade-off documentado em `stream.service.ts`: aceitável para 6 MP3s pequenos; para um catálogo grande, trocar por LRU ou redirect para URL assinada.

### Fluxo de cache (Redis)
```
1ª requisição (miss):  GET /tracks → Redis vazio → busca TRACKS_SEED → salva no Redis (TTL 1h)
2ª+ requisições (hit): GET /tracks → Redis retorna direto → banco nunca é consultado
```
500 VUs simultâneos atingem o Redis em ~0.1ms cada, sem nenhuma query ao banco.

### Fluxo de eventos (BullMQ)
```
Browser → POST /events/play { trackId } → HTTP 202 (aceito imediatamente)
                                        ↓ (assíncrono)
                            PlayEventsProcessor processa a fila
                            → incrementa contador de plays por track
```
O endpoint retorna imediatamente sem bloquear a resposta do usuário.

## Deploy

### Backend — Railway

1. Criar projeto no Railway apontando para este repo.
2. Em **Settings → Service**, setar `Root Directory` = `streaming-api`.
3. Em **Variables**, adicionar `SUPABASE_URL`, `SUPABASE_KEY`, `CORS_ORIGIN`.
4. Em **+ New → Database → Redis**, adicionar add-on Redis. `REDIS_URL` é injetado automaticamente.
5. Railway usa `railway.json` (start command = `npm run start:prod`).
6. Healthcheck path: `/` (NestJS responde "Hello World!" no controller default).

### Frontend — Vercel

URL de produção: **https://music-streaming-red.vercel.app**

1. Importar repo no Vercel.
2. Em **Settings → General**, setar `Root Directory` = `streaming-web`.
3. Em **Environment Variables**, adicionar `NEXT_PUBLIC_API_URL` = URL pública do Railway.
4. Framework preset: Next.js (auto-detectado).

### Supabase

Projeto: **music-streaming-database**

1. Criar projeto no Supabase.
2. **Storage → New Bucket** com nome `tracks`, marcado como **público**.
3. Upload manual dos 6 arquivos de `streaming-api/audio/` para o bucket.
4. Copiar `Project URL` e `anon public key` para as env vars do Railway.
