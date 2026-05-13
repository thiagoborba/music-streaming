import http from 'k6/http';
import { check, sleep } from 'k6';
import { Options } from 'k6/options';

export const options: Options = {
  stages: [
    { duration: '10s', target: 100 },
    { duration: '20s', target: 500 },
    { duration: '10s', target: 0 },
  ],
  thresholds: {
    http_req_duration: ['p(95)<500'],
    http_req_failed: ['rate<0.01'],
  },
};

const BASE_URL = 'http://localhost:3001';
const TRACK_IDS = ['1', '2', '3'];

export default function (): void {
  const trackId = TRACK_IDS[Math.floor(Math.random() * TRACK_IDS.length)];

  const streamRes = http.get(`${BASE_URL}/stream/${trackId}`, {
    headers: { Range: 'bytes=0-65535' },
  });

  check(streamRes, {
    'stream status 206': (r) => r.status === 206,
    'content-range header present': (r) => r.headers['Content-Range'] !== undefined,
    'accept-ranges header present': (r) => r.headers['Accept-Ranges'] === 'bytes',
  });

  const tracksRes = http.get(`${BASE_URL}/tracks`);
  check(tracksRes, {
    'tracks status 200': (r) => r.status === 200,
  });

  http.post(
    `${BASE_URL}/events/play`,
    JSON.stringify({ trackId }),
    { headers: { 'Content-Type': 'application/json' } },
  );

  sleep(1);
}
