import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULT_CHART_STATE } from './chartValidation.ts';
import { DEFAULT_FILTERS } from './reportFilters.ts';
import {
  DASHBOARD_SCHEMA_VERSION, DEFAULT_DASHBOARD_STATE, decodeDashboardState,
} from './dashboardState.ts';

const legacyState = { charts: DEFAULT_CHART_STATE, filters: DEFAULT_FILTERS };

test('hydrates schema-4 rooms with all six default contracts', () => {
  const result = decodeDashboardState(legacyState, 4);
  assert.equal(result.ok, true);
  if (result.ok) assert.deepEqual(result.data.chartContracts, DEFAULT_DASHBOARD_STATE.chartContracts);
});

test('accepts only a complete validated schema-5 dashboard state', () => {
  assert.equal(decodeDashboardState(DEFAULT_DASHBOARD_STATE, DASHBOARD_SCHEMA_VERSION).ok, true);
  assert.equal(decodeDashboardState({ ...legacyState }, DASHBOARD_SCHEMA_VERSION).ok, false);
  assert.equal(decodeDashboardState({ ...DEFAULT_DASHBOARD_STATE, chartContracts: { ...DEFAULT_DASHBOARD_STATE.chartContracts, arr_mix: { version: 1, chartId: 'arr_mix', presentation: 'donut', url: '/secret' } } }, DASHBOARD_SCHEMA_VERSION).ok, false);
  assert.equal(decodeDashboardState({ charts: [], filters: {}, chartContracts: DEFAULT_DASHBOARD_STATE.chartContracts }, DASHBOARD_SCHEMA_VERSION).ok, false);
});
