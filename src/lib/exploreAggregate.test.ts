import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildAggregateChartPlan, projectAggregateRows } from './exploreAggregate.ts';

test('plans the default dimension-table chart as an exact aggregate', () => {
  const result = buildAggregateChartPlan('customers', {
    mark: 'bar',
    encoding: {
      x: { field: 'name', type: 'nominal' },
      y: { field: 'name', type: 'quantitative', aggregate: 'count' },
    },
  });
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.deepEqual(result.data.query.dimensions, [{ field: { dataset: 'customers', field: 'name' } }]);
  assert.deepEqual(result.data.query.measures, [{ field: { dataset: 'customers', field: 'customer_id' }, aggregate: 'count' }]);
  assert.equal(result.data.query.limit, 500);
  assert.deepEqual(projectAggregateRows(result.data, [
    { 'customers.name': 'Acme', 'customers.customer_id:count': 3 },
  ]), [{ name: 'Acme', __vivid_y: 3 }]);
});

test('plans a time-series chart using the server aggregate key', () => {
  const result = buildAggregateChartPlan('mrr_monthly', {
    mark: 'line',
    encoding: {
      x: { field: 'month', type: 'temporal' },
      y: { field: 'mrr', type: 'quantitative', aggregate: 'mean' },
    },
  });
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.deepEqual(result.data.query.dimensions, [{ field: { dataset: 'mrr_monthly', field: 'month' } }]);
  assert.deepEqual(result.data.query.measures, [{ field: { dataset: 'mrr_monthly', field: 'mrr' }, aggregate: 'avg' }]);
  assert.equal(result.data.query.timeGrain, 'month');
  assert.deepEqual(projectAggregateRows(result.data, [
    { 'mrr_monthly.month': '2026-09-01', 'mrr_monthly.mrr:avg': 42.5 },
  ]), [{ month: '2026-09-01', __vivid_y: 42.5 }]);
});

test('rejects a chart field that cannot be an aggregate measure', () => {
  const result = buildAggregateChartPlan('customers', {
    mark: 'bar',
    encoding: {
      x: { field: 'region', type: 'nominal' },
      y: { field: 'region', type: 'quantitative', aggregate: 'sum' },
    },
  });
  assert.equal(result.ok, false);
  if (!result.ok) assert.equal(result.reason, 'invalid_measure');
});

test('does not silently move client-side bins into an unbinned exact query', () => {
  const result = buildAggregateChartPlan('mrr_monthly', {
    mark: 'bar',
    encoding: {
      x: { field: 'mrr', type: 'quantitative', bin: true },
      y: { field: 'mrr', type: 'quantitative', aggregate: 'sum' },
    },
  });
  assert.equal(result.ok, false);
  if (!result.ok) assert.equal(result.reason, 'unsupported_bin');
});

test('rejects a future chart-contract version instead of guessing its shape', () => {
  const result = buildAggregateChartPlan('mrr_monthly', {
    version: 2,
    mark: 'line',
    encoding: {
      x: { field: 'month', type: 'temporal' },
      y: { field: 'mrr', type: 'quantitative', aggregate: 'sum' },
    },
  });
  assert.equal(result.ok, false);
  if (!result.ok) assert.equal(result.reason, 'invalid_value');
});

test('rejects mark/channel combinations that cannot describe an aggregate chart', () => {
  const arcWithXY = buildAggregateChartPlan('customers', {
    mark: 'arc',
    encoding: {
      x: { field: 'region', type: 'nominal' },
      theta: { field: 'customer_id', type: 'quantitative', aggregate: 'count' },
    },
  });
  assert.equal(arcWithXY.ok, false);
  if (!arcWithXY.ok) assert.equal(arcWithXY.reason, 'invalid_combination');

  const lineWithTheta = buildAggregateChartPlan('mrr_monthly', {
    mark: 'line',
    encoding: {
      x: { field: 'month', type: 'temporal' },
      y: { field: 'mrr', type: 'quantitative', aggregate: 'sum' },
      theta: { field: 'mrr', type: 'quantitative', aggregate: 'sum' },
    },
  });
  assert.equal(lineWithTheta.ok, false);
  if (!lineWithTheta.ok) assert.equal(lineWithTheta.reason, 'invalid_combination');
});
