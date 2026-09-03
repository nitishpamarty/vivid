import test from 'node:test';
import assert from 'node:assert/strict';
import { createRateLimiter, readJsonBody, rateLimitKey, requestLimits } from '../../supabase/functions/_shared/observability.ts';

test('request limits have bounded defaults and mutation quotas are stricter', () => {
  const query = requestLimits('query');
  const mutation = requestLimits('mutation');
  assert.equal(query.maxBytes, 1_250_000);
  assert.equal(query.timeoutMs, 5_000);
  assert.ok(mutation.ratePerMinute < query.ratePerMinute);
});

test('rate limiter is scoped and returns a retry hint without exposing its key', () => {
  const limiter = createRateLimiter();
  assert.equal(limiter.take('identity:one', 2, 1_000), null);
  assert.equal(limiter.take('identity:one', 2, 1_001), null);
  const rejected = limiter.take('identity:one', 2, 1_002);
  assert.deepEqual(rejected && { reason: rejected.reason, error: rejected.error }, { reason: 'rate_limited', error: 'Request quota exceeded. Try again shortly.' });
  assert.equal(limiter.take('identity:two', 2, 1_002), null);
  assert.equal(limiter.take('identity:one', 2, 61_001), null);
});

test('request identity hashes bearer material and body limits fail closed', async () => {
  const secret = 'a'.repeat(43);
  const key = await rateLimitKey(new Request('https://vivid.test'), secret);
  assert.notEqual(key, secret);
  assert.ok(!key.includes(secret));
  const tooLarge = await readJsonBody(new Request('https://vivid.test', { method: 'POST', body: JSON.stringify({ value: 'x'.repeat(20) }) }), 10);
  assert.equal(tooLarge.ok, false);
  if (!tooLarge.ok) assert.equal(tooLarge.reason, 'payload_too_large');
});

