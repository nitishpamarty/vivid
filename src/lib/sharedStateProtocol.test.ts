import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseSharedMutationResult } from './sharedStateProtocol.ts';

test('parses a structured stale-version conflict without changing it', () => {
  assert.deepEqual(parseSharedMutationResult({ ok: false, reason: 'conflict', error: 'Dashboard changed elsewhere.', currentVersion: 4 }), {
    ok: false, reason: 'conflict', error: 'Dashboard changed elsewhere.', currentVersion: 4,
  });
});

test('rejects malformed shared-state responses', () => {
  assert.deepEqual(parseSharedMutationResult({ ok: true, data: {} }), {
    ok: false, reason: 'invalid_response', error: 'Shared-state service returned an invalid result.',
  });
});
