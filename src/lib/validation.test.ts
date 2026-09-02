// Covers the trust boundary agent-supplied patches cross: validatePatch and
// validateFilterPatch are the only things standing between a WebMCP tool call
// and dashboard state, so this is the one check ponytail leaves behind.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { validatePatch } from './chartValidation.ts';
import { validateFilterPatch } from './reportFilters.ts';

test('validatePatch accepts a valid enum and range value', () => {
  assert.equal(validatePatch('arr_bridge', { windowMonths: 24, barWidth: 0.6 }).ok, true);
});

test('validatePatch rejects an unknown chart id', () => {
  const result = validatePatch('not_a_chart', { windowMonths: 24 });
  assert.equal(result.ok, false);
  assert.equal((result as { reason: string }).reason, 'unknown_chart');
});

test('validatePatch rejects an unknown field', () => {
  const result = validatePatch('arr_bridge', { title: 'nope' });
  assert.equal(result.ok, false);
  assert.equal((result as { reason: string }).reason, 'unknown_field');
});

test('validatePatch rejects an out-of-enum value', () => {
  const result = validatePatch('arr_bridge', { windowMonths: 18 });
  assert.equal(result.ok, false);
  assert.equal((result as { reason: string }).reason, 'invalid_value');
});

test('validatePatch rejects an off-step range value', () => {
  const result = validatePatch('arr_bridge', { barWidth: 0.61 });
  assert.equal(result.ok, false);
  assert.equal((result as { reason: string }).reason, 'invalid_value');
});

test('validatePatch rejects an empty patch', () => {
  const result = validatePatch('arr_bridge', {});
  assert.equal(result.ok, false);
  assert.equal((result as { reason: string }).reason, 'empty_patch');
});

test('validateFilterPatch accepts a valid enum value', () => {
  assert.equal(validateFilterPatch({ segment: 'Enterprise' }).ok, true);
});

test('validateFilterPatch rejects an unknown field', () => {
  const result = validateFilterPatch({ notAField: 'x' });
  assert.equal(result.ok, false);
  assert.equal((result as { reason: string }).reason, 'unknown_field');
});

test('validateFilterPatch rejects an accountName not in the known list and points to discovery', () => {
  const result = validateFilterPatch({ accountName: 'Acme' }, ['Globex']);
  assert.equal(result.ok, false);
  assert.equal((result as { reason: string }).reason, 'invalid_value');
  assert.match((result as { error: string }).error, /find_account_values/);
});

test('validateFilterPatch accepts any exact known accountName', () => {
  assert.equal(validateFilterPatch({ accountName: 'Globex' }, ['Globex']).ok, true);
});
