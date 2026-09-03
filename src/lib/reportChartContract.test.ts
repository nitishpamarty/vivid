import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  DEFAULT_REPORT_CHART_CONTRACTS, REPORT_CHART_IDS, REVENUE_CHART_REGISTRY,
  reportChartOptions, validateReportChartContract, validateReportChartContracts,
} from './reportChartContract.ts';

test('registry covers all six Revenue charts with exact defaults and renderers', () => {
  assert.deepEqual(Object.keys(REVENUE_CHART_REGISTRY), REPORT_CHART_IDS);
  assert.deepEqual(reportChartOptions().map((option) => option.default), Object.values(DEFAULT_REPORT_CHART_CONTRACTS));
  assert.deepEqual(reportChartOptions().map((option) => option.renderers), [
    ['arr_mix_donut', 'arr_mix_bar'], ['top_accounts_ranked_list', 'top_accounts_bar'],
    ['net_new_logos_heatmap', 'net_new_logos_bar'], ['arr_bridge_waterfall'],
    ['retention_nrr_line'], ['retention_churn_line'],
  ]);
});

test('accepts only the approved intent contract and rejects raw escape hatches', () => {
  assert.deepEqual(validateReportChartContract({ version: 1, chartId: 'arr_mix', presentation: 'bar' }), {
    ok: true, data: { version: 1, chartId: 'arr_mix', presentation: 'bar' },
  });
  for (const bad of [
    { version: 2, chartId: 'arr_mix', presentation: 'donut' },
    { version: 1, chartId: 'arr_bridge', presentation: 'bar' },
    { version: 1, chartId: 'not_a_chart', presentation: 'donut' },
    { version: 1, chartId: 'arr_mix', presentation: 'donut', data: { values: ['secret'] } },
    { version: 1, chartId: 'arr_mix', presentation: 'donut', query: 'select secret' },
  ]) assert.equal(validateReportChartContract(bad).ok, false);
});

test('requires a complete canonical contract map for persisted version 5 state', () => {
  assert.equal(validateReportChartContracts(DEFAULT_REPORT_CHART_CONTRACTS).ok, true);
  const missing = { ...DEFAULT_REPORT_CHART_CONTRACTS };
  delete (missing as Partial<typeof missing>).arr_mix;
  assert.equal(validateReportChartContracts(missing).ok, false);
  assert.equal(validateReportChartContracts({ ...DEFAULT_REPORT_CHART_CONTRACTS, secret: DEFAULT_REPORT_CHART_CONTRACTS.arr_mix }).ok, false);
  assert.equal(validateReportChartContracts({ ...DEFAULT_REPORT_CHART_CONTRACTS, arr_mix: { version: 1, chartId: 'arr_mix', presentation: 'donut', config: {} } }).ok, false);
});
