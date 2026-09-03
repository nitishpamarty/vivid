import assert from 'node:assert/strict';
import test from 'node:test';
import { buildComposedChart, getCompositionFields, getRelationshipOptions } from './explorationComposition.ts';
import { buildAggregateChartPlan } from './exploreAggregate.ts';

test('builds a governed mrr-by-customer-region chart through the declared path', () => {
  const result = buildComposedChart({
    source: 'mrr_monthly',
    relationshipPath: ['mrr_monthly_to_customers'],
    dimension: { dataset: 'customers', field: 'region' },
    measure: { field: { dataset: 'mrr_monthly', field: 'mrr' }, aggregate: 'sum' },
    filter: { field: { dataset: 'customers', field: 'segment' }, operator: 'eq', value: 'Enterprise' },
  });
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.deepEqual(result.data.query.relationshipPath, ['mrr_monthly_to_customers']);
  assert.deepEqual(result.data.query.dimensions, [{ field: { dataset: 'customers', field: 'region' } }]);
  assert.deepEqual(result.data.query.measures, [{ field: { dataset: 'mrr_monthly', field: 'mrr' }, aggregate: 'sum' }]);
  assert.deepEqual(result.data.query.filters, [{ field: { dataset: 'customers', field: 'segment' }, operator: 'eq', value: 'Enterprise' }]);

  const plan = buildAggregateChartPlan(result.data.query.source, result.data.chart, result.data.query.relationshipPath);
  assert.equal(plan.ok, true);
  if (plan.ok) {
    assert.equal(plan.data.channels[0]?.resultKey, 'customers.region');
    assert.equal(plan.data.channels[1]?.resultKey, 'mrr_monthly.mrr:sum');
  }
});

test('composition field options stay scoped to the explicit path', () => {
  assert.deepEqual(getRelationshipOptions('mrr_monthly').map(({ id }) => id), ['mrr_monthly_to_customers']);
  const withoutPath = getCompositionFields('mrr_monthly').map(({ ref }) => `${ref.dataset}.${ref.field}`);
  assert.equal(withoutPath.includes('customers.region'), false);
  const withPath = getCompositionFields('mrr_monthly', ['mrr_monthly_to_customers']).map(({ ref }) => `${ref.dataset}.${ref.field}`);
  assert.equal(withPath.includes('customers.region'), true);
});

test('rejects inferred joins and unsupported relationship paths', () => {
  const inferred = buildComposedChart({
    source: 'mrr_monthly', relationshipPath: [],
    dimension: { dataset: 'customers', field: 'region' },
    measure: { field: { dataset: 'mrr_monthly', field: 'mrr' }, aggregate: 'sum' },
  });
  assert.equal(inferred.ok, false);
  if (!inferred.ok) assert.equal(inferred.reason, 'field_not_in_path');

  const unsupported = buildComposedChart({
    source: 'customers', relationshipPath: ['mrr_monthly_to_customers'],
    dimension: { dataset: 'customers', field: 'region' },
    measure: { field: { dataset: 'customers', field: 'customer_id' }, aggregate: 'count' },
  });
  assert.equal(unsupported.ok, false);
  if (!unsupported.ok) assert.equal(unsupported.reason, 'invalid_relationship_path');
});

test('rejects a path field when chart planning is called directly', () => {
  const result = buildAggregateChartPlan('mrr_monthly', {
    mark: 'bar',
    encoding: {
      x: { field: 'region', dataset: 'customers', type: 'nominal' },
      y: { field: 'mrr', dataset: 'mrr_monthly', type: 'quantitative', aggregate: 'sum' },
    },
  });
  assert.equal(result.ok, false);
  if (!result.ok) assert.equal(result.reason, 'field_not_in_path');
});
