import http from 'k6/http';
import { check } from 'k6';
import { Options } from 'k6/options';

const BASE_URL = 'https://music-streaming-production.up.railway.app';
const TRACK_IDS = ['1', '2', '3'];

// 429 é throttling esperado por IP único — não conta como falha de infra
http.setResponseCallback(http.expectedStatuses({ min: 200, max: 399 }, 429));

export const options: Options = {
  scenarios: {
    // Cenário 1: demonstra capacidade do backend com alta concorrência
    concurrent_listeners: {
      executor: 'constant-vus',
      vus: 500,
      duration: '1m',
      exec: 'testPerformance',
    },
    // Cenário 2: valida que o throttler bloqueia corretamente após o limite
    throttler_validation: {
      executor: 'constant-arrival-rate',
      rate: 10,
      timeUnit: '1s',
      duration: '15s',
      preAllocatedVUs: 5,
      maxVUs: 10,
      startTime: '65s',
      exec: 'testThrottler',
    },
  },
  thresholds: {
    http_req_duration: ['p(95)<500'],
    'http_req_failed{scenario:concurrent_listeners}': ['rate<0.01'],
  },
};

export function testPerformance(): void {
  const trackId = TRACK_IDS[Math.floor(Math.random() * TRACK_IDS.length)];

  const streamRes = http.get(`${BASE_URL}/stream/${trackId}`, { redirects: 0 });
  check(streamRes, {
    'stream ok (302 ou 429)': (r) => r.status === 302 || r.status === 429,
  });

  const tracksRes = http.get(`${BASE_URL}/tracks`);
  check(tracksRes, { 'tracks status 200': (r) => r.status === 200 });

  http.post(`${BASE_URL}/events/play`, JSON.stringify({ trackId }), {
    headers: { 'Content-Type': 'application/json' },
  });
}

export function testThrottler(): void {
  const streamRes = http.get(`${BASE_URL}/stream/1`, { redirects: 0 });
  check(streamRes, { 'throttler ativo (429)': (r) => r.status === 429 });
}
