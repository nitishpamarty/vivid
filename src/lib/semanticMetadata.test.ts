import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  normalizeSemanticMetadata,
  type SemanticMetadata,
} from './semanticMetadata.ts';
import {
  createSemanticLayerClient,
  type SemanticLayerResult,
} from './semanticLayerClient.ts';

const cubeMeta = {
  cubes: [{
    name: 'orders', title: 'Orders', description: 'Revenue orders',
    measures: [
      { name: 'orders.total_revenue', title: 'Total revenue', description: 'Gross revenue', type: 'number', aggType: 'sum', sql: 'secret_sql' },
      { name: 'orders.count', type: 'number', aggType: 'count' },
    ],
    dimensions: [
      { name: 'orders.region', title: 'Region', description: 'Sales region', type: 'string', primaryKey: false },
      { name: 'orders.created_at', type: 'time', primaryKey: false },
      { name: 'orders.internal', type: 'string', isVisible: false },
    ],
    joins: [{ name: 'customers', relationship: 'many_to_one', sql: 'secret_join_sql' }],
  }],
};

test('normalizes Cube metadata into typed, compact definitions', () => {
  const result = normalizeSemanticMetadata(cubeMeta);
  assert.equal(result.ok, true);
  if (!result.ok) return;
  const cube = result.data.cubes[0];
  assert.equal(cube.name, 'orders');
  assert.deepEqual(cube.measures[0], {
    name: 'orders.total_revenue', title: 'Total revenue', description: 'Gross revenue',
    type: 'number', aggregation: 'sum',
  });
  assert.equal(cube.measures[1].aggregation, 'count');
  assert.equal(cube.dimensions[1].type, 'time');
  assert.deepEqual(cube.filters[0].operators, ['eq', 'neq', 'in', 'not_in', 'is_null', 'is_not_null']);
  assert.equal(cube.dimensions.some((dimension) => dimension.name === 'orders.internal'), false);
  assert.equal(cube.filters.some((filter) => filter.member === 'orders.internal'), false);
  assert.deepEqual(result.data.relationships, [{ cube: 'orders', targetCube: 'customers', relationship: 'many_to_one' }]);
  assert.equal(JSON.stringify(result.data).includes('secret_sql'), false);
  assert.equal(JSON.stringify(result.data).includes('secret_join_sql'), false);
});

test('fails closed when Cube metadata has no valid cubes', () => {
  assert.deepEqual(normalizeSemanticMetadata({}), {
    ok: false, reason: 'invalid_metadata', error: 'Semantic metadata did not contain a Cube list.',
  });
  assert.deepEqual(normalizeSemanticMetadata({ cubes: [{ name: '', measures: [], dimensions: [] }] }), {
    ok: false, reason: 'invalid_metadata', error: 'Semantic metadata did not contain any valid cubes.',
  });
});

test('caches definitions, deduplicates concurrent loads, and refreshes after expiry', async () => {
  let clock = 100;
  let calls = 0;
  const transport = { invoke: async (): Promise<SemanticLayerResult> => {
    calls += 1;
    return { ok: true, data: cubeMeta };
  } };
  const client = createSemanticLayerClient(transport, { metadataTtlMs: 20, now: () => clock });
  const [first, second] = await Promise.all([client.getBusinessDefinitions(), client.getBusinessDefinitions()]);
  assert.equal(calls, 1);
  assert.deepEqual(first.data, second.data);
  assert.equal((first.data as SemanticMetadata).cubes.length, 1);
  assert.equal(calls, 1);
  clock = 121;
  await client.getBusinessDefinitions();
  assert.equal(calls, 2);
});

test('returns a stale trusted snapshot on refresh failure and an envelope without one', async () => {
  let clock = 0;
  let available = true;
  const client = createSemanticLayerClient({ invoke: async () => {
    if (!available) throw new Error('network');
    return { ok: true, data: cubeMeta };
  } }, { metadataTtlMs: 1, now: () => clock });
  const fresh = await client.getBusinessDefinitions();
  assert.equal(fresh.ok, true);
  clock = 2;
  available = false;
  const stale = await client.getBusinessDefinitions();
  assert.deepEqual(stale, { ok: true, data: fresh.data, reason: 'stale' });

  const unavailable = createSemanticLayerClient({ invoke: async () => { throw new Error('network'); } }, { now: () => 1 });
  assert.deepEqual(await unavailable.getBusinessDefinitions(), {
    ok: false, reason: 'unavailable', error: 'Semantic layer is unavailable. Try again.',
  });
});
