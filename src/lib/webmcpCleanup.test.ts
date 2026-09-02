import { test } from 'node:test';
import assert from 'node:assert/strict';
import { callUnregisterFns } from './webmcpCleanup.ts';

test('cleanup does not throw and still calls real unregister functions, given undefined, a function, or a non-function value', () => {
  let called = 0;
  assert.doesNotThrow(() => callUnregisterFns([undefined, () => called++, 'not-a-function', {}, () => called++]));
  assert.equal(called, 2);
});
