import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mutationBlockReason, shouldApplyVersion } from './sharedStateLifecycle.ts';

test('a Realtime update wins over a delayed older fetch', () => {
  let version = 0;
  const applied: number[] = [];
  if (shouldApplyVersion(version, 2)) { version = 2; applied.push(version); }
  if (shouldApplyVersion(version, 1)) { version = 1; applied.push(version); }
  assert.deepEqual(applied, [2]);
  assert.equal(version, 2);
});

test('connection failures do not become ready or accept invalid versions', () => {
  assert.equal(shouldApplyVersion(0, Number.NaN), false);
  assert.equal(shouldApplyVersion(4, 3), false);
  assert.equal(mutationBlockReason('unavailable'), 'unavailable');
});

test('an immediate mutation is explicitly blocked while connecting', () => {
  assert.equal(mutationBlockReason('connecting'), 'not_ready');
  assert.equal(mutationBlockReason('ready'), null);
});
