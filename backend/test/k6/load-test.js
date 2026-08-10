import http from 'k6/http';
import { check, sleep } from 'k6';
import { Trend } from 'k6/metrics';

/**
 * k6 load test, validates the performance SLOs from the blueprint:
 *   API p95 < 200ms.
 *
 * Run:  BASE_URL=http://localhost:3000 k6 run test/k6/load-test.js
 */
const BASE_URL = __ENV.BASE_URL || 'http://localhost:3000';
const searchLatency = new Trend('vendor_search_latency', true);

export const options = {
  stages: [
    { duration: '30s', target: 50 }, // ramp up
    { duration: '1m', target: 200 }, // sustained load
    { duration: '30s', target: 0 }, // ramp down
  ],
  thresholds: {
    http_req_failed: ['rate<0.01'], // <1% errors
    http_req_duration: ['p(95)<200'], // p95 under 200ms
  },
};

export default function () {
  // Public, cacheable read path, representative hot endpoint.
  const res = http.get(`${BASE_URL}/api/vendors/search?category=photography&page=1&limit=20`);
  searchLatency.add(res.timings.duration);
  check(res, {
    'status is 200': (r) => r.status === 200,
    'has body': (r) => r.body && r.body.length > 0,
  });

  const health = http.get(`${BASE_URL}/api/health/live`);
  check(health, { 'health ok': (r) => r.status === 200 });

  sleep(1);
}
