# music-streaming

Projeto de portfólio demonstrando streaming de áudio com alta concorrência. Construído para entrevistas técnicas sobre escalabilidade.

## Estrutura

```
music-streaming/
├── streaming-api/   # NestJS backend — porta 3001
├── streaming-web/   # Next.js frontend — porta 3000
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

**Requer Redis rodando:** `redis-server` ou `docker run -p 6379:6379 redis`

### Frontend (`streaming-web/`)
```bash
npm run dev    # Next.js dev — porta 3000
npm run build
npm start
```

### Load Test (`load-test/`)
```bash
npm install
npm run build   # webpack → dist/concurrent-listeners.js
k6 run dist/concurrent-listeners.js
```

**Requer k6 instalado:** `sudo apt install k6` ou `brew install k6`

## Variáveis de ambiente

**Backend** — sem `.env` obrigatório em dev (Redis localhost:6379 por padrão)

**Frontend** (`.env.local`):
- `NEXT_PUBLIC_API_URL` — URL do backend (padrão: `http://localhost:3001`)

## Áudio de amostra

Adicione arquivos `.mp3` em `streaming-api/audio/` com os nomes `1.mp3`, `2.mp3`, `3.mp3`.
Sugestão: baixe amostras livres de royalties em freemusicarchive.org ou use qualquer MP3 local.

## Arquitetura

### Fluxo de streaming
```
Browser → GET /stream/:id (Range: bytes=X-Y)
NestJS StreamController → StreamService.createReadStream(start, end)
→ fs.createReadStream() → pipe(response) → HTTP 206
```

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
