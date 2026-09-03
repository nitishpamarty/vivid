import { CHART_IDS, CHART_OPTIONS, validatePatch, type ChartId, type ChartState } from './chartValidation.ts';
import { CHART_METRIC_KEYS, findFieldValue, REPORT_ID } from './reportToolSupport.ts';
import { FILTER_OPTIONS, validateFilterPatch, type ReportFilters } from './reportFilters.ts';
import {
  REPORT_CHART_IDS, reportChartOptions, validateReportChartContract,
  type ReportChartContract, type ReportChartContracts, type ReportChartId,
} from './reportChartContract.ts';
import { callUnregisterFns } from './webmcpCleanup.ts';

// metricKey is the Cube member ("<cube>.<field>") this chart's headline
// number corresponds to — pass it straight through to get_business_definitions
// / query_business_metric to resolve or validate the metric semantically.
const REPORT_FIELDS: Record<ChartId, { fields: string[]; metricKey: string }> = {
  arr_bridge: { fields: ['label', 'month', 'delta', 'priorCum', 'newCum', 'positive'], metricKey: CHART_METRIC_KEYS.arr_bridge },
  retention_nrr: { fields: ['month', 'value'], metricKey: CHART_METRIC_KEYS.retention_nrr },
  retention_churn: { fields: ['month', 'value'], metricKey: CHART_METRIC_KEYS.retention_churn },
};

function chartOptionsWithMetricKey(chartId: ChartId) {
  return { ...CHART_OPTIONS[chartId], metricKey: CHART_METRIC_KEYS[chartId] };
}

export interface ToolBridge {
  getChartState: () => ChartState;
  applyChartPatch: (chartId: ChartId, patch: Record<string, unknown>) => Promise<ChartState[ChartId]>;
  getFilters: () => ReportFilters;
  applyFilterPatch: (patch: Record<string, unknown>) => Promise<ReportFilters>;
  getTopAccounts: () => { name: string; arr: number }[];
  getAccountMatches: (query: string) => { name: string; arr: number }[];
  getValidAccountNames: () => readonly string[];
  getChartContracts: () => ReportChartContracts;
  applyChartContract: (chartId: ReportChartId, contract: ReportChartContract) => Promise<ReportChartContract>;
}

function tool(name: string, description: string, inputSchema: Record<string, unknown>, run: (input: Record<string, unknown>) => unknown) {
  return {
    name,
    description,
    inputSchema,
    execute: async (input: Record<string, unknown>) => {
      try {
        return await run(input ?? {});
      } catch (error) {
        if (error instanceof Error && error.message === 'not_ready') {
          return { ok: false, reason: 'not_ready', error: 'Shared session is still connecting.' };
        }
        return { ok: false, reason: 'unavailable', error: 'Shared session is unavailable. Try again.' };
      }
    },
  };
}

export function registerNorthbeamTools(bridge: ToolBridge): () => void {
  if (typeof document === 'undefined' || !document.modelContext) return () => {};

  const tools = [
    tool(
      'get_report_context',
      'Get the active report id, the current knob state of the two agent-editable charts (ARR bridge, retention NRR/churn), the fields available on each plus its metricKey (the Cube member, e.g. "mrr_monthly.total_mrr", to pass to get_business_definitions/query_business_metric), the active report-wide filters (segment, region, planTier, channel, contractType, accountName) which cross-filter all six panels, and a current top-5 account summary. accountName accepts any exact known customer name; use find_account_values for compact discovery beyond the top five.',
      { type: 'object', properties: {} },
      () => ({
        ok: true,
        data: {
          reportId: REPORT_ID, charts: bridge.getChartState(), fields: REPORT_FIELDS,
          filters: bridge.getFilters(), topAccounts: bridge.getTopAccounts(),
          chartContracts: bridge.getChartContracts(),
        },
      }),
    ),
    tool(
      'list_report_chart_options',
      'List the six Revenue chart contracts, their approved presentations, renderer ids, defaults, and fixed invariants. These are intent-only options; raw fields, data, queries, and Vega specifications are not accepted.',
      { type: 'object', properties: {} },
      () => ({ ok: true, data: reportChartOptions() }),
    ),
    tool(
      'get_report_chart_contract',
      'Get the canonical presentation contract for one Revenue chart.',
      { type: 'object', properties: { chartId: { type: 'string', enum: REPORT_CHART_IDS } }, required: ['chartId'] },
      (input) => {
        const chartId = input.chartId as ReportChartId;
        if (!REPORT_CHART_IDS.includes(chartId)) {
          return { ok: false, reason: 'unknown_chart', error: `"${String(input.chartId ?? '')}" is not a Revenue chart. Valid ids: ${REPORT_CHART_IDS.join(', ')}.` };
        }
        return { ok: true, data: bridge.getChartContracts()[chartId] };
      },
    ),
    tool(
      'set_report_chart_contract',
      'Set one approved Revenue chart presentation atomically. Accepts only { chartId, contract: { version: 1, chartId, presentation } }; raw specs, data, URLs, transforms, config, fields, queries, and aggregations are rejected.',
      { type: 'object', properties: { chartId: { type: 'string', enum: REPORT_CHART_IDS }, contract: { type: 'object' } }, required: ['chartId', 'contract'] },
      async (input) => {
        const chartId = input.chartId as ReportChartId;
        if (!REPORT_CHART_IDS.includes(chartId)) {
          return { ok: false, reason: 'unknown_chart', error: `"${String(input.chartId ?? '')}" is not a Revenue chart. Valid ids: ${REPORT_CHART_IDS.join(', ')}.` };
        }
        const validation = validateReportChartContract(input.contract);
        if (!validation.ok) return { ok: false, reason: validation.reason, error: validation.error };
        if (validation.data.chartId !== chartId) {
          return { ok: false, reason: 'invalid_contract', error: `contract.chartId must be "${chartId}".` };
        }
        const data = await bridge.applyChartContract(chartId, validation.data);
        return { ok: true, data };
      },
    ),
    tool(
      'list_report_options',
      'List the mark/field allow-list for one or all agent-editable charts (each tagged with its metricKey, the Cube member for get_business_definitions/query_business_metric), plus the allow-list for the report-wide filters — the only values update_chart_spec and set_report_filters will accept.',
      { type: 'object', properties: { chartId: { type: 'string', enum: CHART_IDS } } },
      (input) => {
        const chartId = input.chartId as ChartId | undefined;
        if (chartId && !CHART_IDS.includes(chartId)) {
          return { ok: false, reason: 'unknown_chart', error: `"${chartId}" is not an agent-editable chart. Valid ids: ${CHART_IDS.join(', ')}.` };
        }
        const ids = chartId ? [chartId] : CHART_IDS;
        const charts = Object.fromEntries(ids.map((id) => [id, chartOptionsWithMetricKey(id)]));
        return { ok: true, data: { charts, filters: FILTER_OPTIONS } };
      },
    ),
    tool(
      'update_chart_spec',
      'Apply a validated patch (field: value pairs from list_report_options) to one agent-editable chart. Atomic replace — the whole chart re-renders from the new knob state or nothing changes.',
      {
        type: 'object',
        properties: { chartId: { type: 'string', enum: CHART_IDS }, patch: { type: 'object' } },
        required: ['chartId', 'patch'],
      },
      async (input) => {
        const chartId = input.chartId as string;
        const patch = input.patch as Record<string, unknown>;
        const validation = validatePatch(chartId, patch);
        if (!validation.ok) return { ok: false, reason: validation.reason, error: validation.error };
        const data = await bridge.applyChartPatch(chartId as ChartId, patch);
        return { ok: true, data };
      },
    ),
    tool(
      'set_report_filters',
      'Set one or more report-wide filters (segment, region, planTier, channel, contractType from list_report_options; accountName is any exact known customer name, discoverable with find_account_values, for drilling into a single account). Cross-filters all six panels, including the four non-Vega ones. Use "all" to clear a filter. Validated patch, atomic replace.',
      { type: 'object', properties: { patch: { type: 'object' } }, required: ['patch'] },
      async (input) => {
        const patch = input.patch as Record<string, unknown>;
        const validation = validateFilterPatch(patch, bridge.getValidAccountNames());
        if (!validation.ok) return { ok: false, reason: validation.reason, error: validation.error };
        const data = await bridge.applyFilterPatch(patch);
        return { ok: true, data };
      },
    ),
    tool(
      'find_account_values',
      'Find up to eight exact canonical customer names matching a phrase. Use one returned name as set_report_filters.accountName; the validator accepts any known customer, not only the visible top five.',
      { type: 'object', properties: { query: { type: 'string' } }, required: ['query'] },
      (input) => {
        const query = String(input.query ?? '').trim();
        if (!query) return { ok: false, reason: 'invalid_query', error: 'query must be a non-empty customer-name phrase.' };
        return { ok: true, data: { matches: bridge.getAccountMatches(query) } };
      },
    ),
    tool(
      'find_field_values',
      'Resolve a free-text phrase (a color name, a time range, a segment or region name) to the canonical field/value pair update_chart_spec or set_report_filters expects. Always returns its best guess — never asks for clarification.',
      { type: 'object', properties: { phrase: { type: 'string' } }, required: ['phrase'] },
      (input) => {
        const phrase = String(input.phrase ?? '');
        return { ok: true, data: findFieldValue(phrase) };
      },
    ),
  ];

  const unregisterFns = tools.map((t) => document.modelContext!.registerTool(t));
  return () => callUnregisterFns(unregisterFns);
}
