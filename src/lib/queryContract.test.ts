import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  QUERY_DATASET_CATALOG,
  QUERY_LIMITS,
  RELATIONSHIP_CATALOG,
  getReachableDatasets,
  validateQueryContract,
} from './queryContract.ts';

const assertReason = (input: unknown, reason: string) => {
  const result = validateQueryContract(input);
  assert.equal(result.ok, false);
  assert.equal((result as { reason: string }).reason, reason);
};

test('catalog covers the seven current tables and only the two explicit joins', () => {
  assert.deepEqual(Object.keys(QUERY_DATASET_CATALOG).sort(), [
    'activity_heatmap', 'cac_monthly', 'customers', 'employees', 'mrr_monthly',
    'report_views_monthly', 'reports',
  ]);
  assert.deepEqual(RELATIONSHIP_CATALOG.map(({ id }) => id), [
    'mrr_monthly_to_customers', 'report_views_monthly_to_reports',
  ]);
  assert.deepEqual(getReachableDatasets('mrr_monthly', ['mrr_monthly_to_customers']), ['mrr_monthly', 'customers']);
});

test('accepts a bounded aggregate over an approved relationship path', () => {
  const result = validateQueryContract({
    source: 'mrr_monthly',
    relationshipPath: ['mrr_monthly_to_customers'],
    dimensions: [
      { field: { dataset: 'customers', field: 'region' } },
      { field: { dataset: 'mrr_monthly', field: 'month' } },
    ],
    measures: [{ field: { dataset: 'mrr_monthly', field: 'mrr' }, aggregate: 'sum' }],
    filters: [{ field: { dataset: 'customers', field: 'segment' }, operator: 'eq', value: 'Enterprise' }],
    sort: [{ field: { dataset: 'mrr_monthly', field: 'mrr' }, direction: 'desc' }],
    timeGrain: 'month',
    limit: 25,
  });
  assert.equal(result.ok, true);
  if (result.ok) {
    assert.equal(result.data.limit, 25);
    assert.equal(result.data.offset, 0);
    assert.deepEqual(result.data.relationshipPath, ['mrr_monthly_to_customers']);
  }
});

test('accepts a measure-only KPI and applies safe pagination defaults', () => {
  const result = validateQueryContract({
    source: 'customers',
    dimensions: [],
    measures: [{ field: { dataset: 'customers', field: 'customer_id' }, aggregate: 'count' }],
  });
  assert.equal(result.ok, true);
  if (result.ok) assert.deepEqual({ limit: result.data.limit, offset: result.data.offset }, { limit: 100, offset: 0 });
});

test('rejects unknown keys, datasets, fields, and arbitrary joins', () => {
  assertReason({ source: 'customers', dimensions: [], measures: [{ field: { dataset: 'customers', field: 'customer_id' }, aggregate: 'count' }], sql: 'select 1' }, 'unknown_field');
  assertReason({ source: 'not_a_table', dimensions: [], measures: [] }, 'unknown_dataset');
  assertReason({ source: 'customers', dimensions: [{ field: { dataset: 'customers', field: 'nope' } }], measures: [{ field: { dataset: 'customers', field: 'customer_id' }, aggregate: 'count' }] }, 'unknown_field');
  assertReason({ source: 'customers', dimensions: [{ field: { dataset: 'customers', field: '__proto__' } }], measures: [{ field: { dataset: 'customers', field: 'customer_id' }, aggregate: 'count' }] }, 'unknown_field');
  assertReason({ source: 'customers', dimensions: [{ field: { dataset: 'customers', field: 'constructor' } }], measures: [{ field: { dataset: 'customers', field: 'customer_id' }, aggregate: 'count' }] }, 'unknown_field');
  assertReason({ source: 'mrr_monthly', relationshipPath: ['customers_to_mrr_monthly'], dimensions: [], measures: [{ field: { dataset: 'mrr_monthly', field: 'mrr' }, aggregate: 'sum' }] }, 'unknown_relationship');
});

test('rejects fields outside the approved path and inferred same-name joins', () => {
  assertReason({
    source: 'mrr_monthly', dimensions: [{ field: { dataset: 'customers', field: 'region' } }],
    measures: [{ field: { dataset: 'mrr_monthly', field: 'mrr' }, aggregate: 'sum' }],
  }, 'field_not_in_path');
  assertReason({
    source: 'customers', relationshipPath: ['mrr_monthly_to_customers'], dimensions: [],
    measures: [{ field: { dataset: 'customers', field: 'customer_id' }, aggregate: 'count' }],
  }, 'invalid_relationship_path');
});

test('rejects invalid dimensions, measures, operators, and typed values', () => {
  assertReason({ source: 'mrr_monthly', dimensions: [{ field: { dataset: 'mrr_monthly', field: 'mrr' } }], measures: [{ field: { dataset: 'mrr_monthly', field: 'mrr' }, aggregate: 'sum' }] }, 'invalid_dimension');
  assertReason({ source: 'mrr_monthly', dimensions: [], measures: [{ field: { dataset: 'mrr_monthly', field: 'mrr' }, aggregate: 'count' }] }, 'invalid_measure');
  assertReason({ source: 'customers', dimensions: [], measures: [{ field: { dataset: 'customers', field: 'customer_id' }, aggregate: 'count' }], filters: [{ field: { dataset: 'customers', field: 'segment' }, operator: 'contains', value: 'Enterprise' }] }, 'invalid_operator');
  assertReason({ source: 'customers', dimensions: [], measures: [{ field: { dataset: 'customers', field: 'customer_id' }, aggregate: 'count' }], filters: [{ field: { dataset: 'customers', field: 'segment' }, operator: 'eq', value: 42 }] }, 'invalid_value');
  assertReason({ source: 'customers', dimensions: [], measures: [{ field: { dataset: 'customers', field: 'customer_id' }, aggregate: 'count' }], filters: [{ field: { dataset: 'customers', field: 'segment' }, operator: 'is_null', value: null }] }, 'invalid_value');
});

test('rejects unsupported time grains and unsafe sort keys', () => {
  assertReason({ source: 'mrr_monthly', dimensions: [{ field: { dataset: 'mrr_monthly', field: 'month' } }], measures: [{ field: { dataset: 'mrr_monthly', field: 'mrr' }, aggregate: 'sum' }], timeGrain: 'week' }, 'unsupported_time_grain');
  assertReason({ source: 'mrr_monthly', dimensions: [], measures: [{ field: { dataset: 'mrr_monthly', field: 'mrr' }, aggregate: 'sum' }], sort: [{ field: { dataset: 'mrr_monthly', field: 'customer_id' }, direction: 'desc' }] }, 'invalid_sort');
});

test('enforces response, pagination, and shape limits', () => {
  assertReason({ source: 'customers', dimensions: [], measures: [{ field: { dataset: 'customers', field: 'customer_id' }, aggregate: 'count' }], limit: QUERY_LIMITS.maxLimit + 1 }, 'invalid_pagination');
  assertReason({ source: 'customers', dimensions: [], measures: [{ field: { dataset: 'customers', field: 'customer_id' }, aggregate: 'count' }], offset: -1 }, 'invalid_pagination');
  assertReason({ source: 'customers', dimensions: [], measures: [] }, 'limit_exceeded');
  assertReason({ source: 'customers', dimensions: Array.from({ length: QUERY_LIMITS.maxDimensions + 1 }, () => ({ field: { dataset: 'customers', field: 'region' } })), measures: [{ field: { dataset: 'customers', field: 'customer_id' }, aggregate: 'count' }] }, 'limit_exceeded');
});

test('requires arrays for membership filters and rejects malformed values', () => {
  const measure = { field: { dataset: 'customers', field: 'customer_id' }, aggregate: 'count' };
  assertReason({
    source: 'customers', dimensions: [], measures: [measure],
    filters: [{ field: { dataset: 'customers', field: 'segment' }, operator: 'in', value: 'Enterprise' }],
  }, 'invalid_value');
  assertReason({
    source: 'customers', dimensions: [], measures: [measure],
    filters: [{ field: { dataset: 'customers', field: 'segment' }, operator: 'not_in', value: [] }],
  }, 'invalid_value');
  assertReason({
    source: 'customers', dimensions: [], measures: [measure],
    filters: [{ field: { dataset: 'customers', field: 'segment' }, operator: 'in', value: ['Enterprise', 7] }],
  }, 'invalid_value');
  assertReason({
    source: 'customers', dimensions: [], measures: [measure],
    filters: [{ field: { dataset: 'customers', field: 'segment' }, operator: 'eq', value: ['Enterprise'] }],
  }, 'invalid_value');
});

test('rejects duplicate or out-of-path sort keys', () => {
  const query = {
    source: 'mrr_monthly',
    dimensions: [{ field: { dataset: 'mrr_monthly', field: 'month' } }],
    measures: [{ field: { dataset: 'mrr_monthly', field: 'mrr' }, aggregate: 'sum' }],
  };
  assertReason({ ...query, sort: [
    { field: { dataset: 'mrr_monthly', field: 'month' }, direction: 'asc' },
    { field: { dataset: 'mrr_monthly', field: 'month' }, direction: 'desc' },
  ] }, 'invalid_sort');
  assertReason({ ...query, sort: [{ field: { dataset: 'customers', field: 'region' }, direction: 'asc' }] }, 'field_not_in_path');
});

test('enforces catalog aggregation/type combinations', () => {
  assertReason({
    source: 'mrr_monthly', dimensions: [],
    measures: [{ field: { dataset: 'mrr_monthly', field: 'mrr' }, aggregate: 'count' }],
  }, 'invalid_measure');
  assertReason({
    source: 'customers', dimensions: [],
    measures: [{ field: { dataset: 'customers', field: 'name' }, aggregate: 'sum' }],
  }, 'invalid_measure');
  assertReason({
    source: 'customers', dimensions: [{ field: { dataset: 'customers', field: 'name' } }],
    measures: [{ field: { dataset: 'customers', field: 'customer_id' }, aggregate: 'count' }],
    timeGrain: 'day',
  }, 'unsupported_time_grain');
  assertReason({
    source: 'customers', dimensions: [{ field: { dataset: 'customers', field: 'name' } }],
    measures: [{ field: { dataset: 'customers', field: 'customer_id' }, aggregate: 'count' }],
    timeGrain: 'month',
  }, 'unsupported_time_grain');
});

test('treats SQL, expressions, and arbitrary joins as unknown intent', () => {
  const safeMeasure = { field: { dataset: 'customers', field: 'customer_id' }, aggregate: 'count' };
  assertReason({
    source: 'customers', dimensions: [], measures: [safeMeasure],
    filters: [{ field: { dataset: 'customers', field: 'name; DROP TABLE customers' }, operator: 'eq', value: 'x' }],
  }, 'unknown_field');
  assertReason({
    source: 'customers', dimensions: [{ field: { dataset: 'customers', field: 'name || (SELECT password)' } }], measures: [safeMeasure],
  }, 'unknown_field');
  assertReason({
    source: 'customers', relationshipPath: ['mrr_monthly_to_customers'], dimensions: [], measures: [safeMeasure],
  }, 'invalid_relationship_path');
  assertReason({
    source: 'mrr_monthly', relationshipPath: ['mrr_monthly_to_customers', 'customers_to_employees'], dimensions: [],
    measures: [{ field: { dataset: 'mrr_monthly', field: 'mrr' }, aggregate: 'sum' }],
  }, 'unknown_relationship');
});

test('always returns the structured validation envelope for hostile shapes', () => {
  const hostileInputs: unknown[] = [
    null, [], 'select * from customers', 42,
    { source: 'customers', dimensions: {}, measures: [] },
    { source: 'customers', dimensions: [], measures: [{ field: { dataset: 'customers', field: 'customer_id' }, aggregate: { toString: () => { throw new Error('coercion trap'); } } }] },
    { source: 'customers', dimensions: [], measures: [{ field: { dataset: 'customers', field: 'customer_id' }, aggregate: 'count' }], limit: Infinity },
  ];
  for (const input of hostileInputs) {
    const result = validateQueryContract(input);
    assert.equal(typeof result.ok, 'boolean');
    if (!result.ok) {
      assert.equal(typeof result.reason, 'string');
      assert.equal(typeof result.error, 'string');
    }
  }
});
