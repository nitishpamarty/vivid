import {
  CHART_IDS, CHART_OPTIONS, REPORT_ID, findFieldValue, validatePatch,
  type ChartId, type ChartState,
} from './chartState';
import { FILTER_OPTIONS, validateFilterPatch, type ReportFilters } from './reportFilters';
import type { SemanticLayerResult } from './semanticLayerClient';

const REPORT_FIELDS: Record<ChartId, string[]> = {
  arr_bridge: ['label', 'month', 'delta', 'priorCum', 'newCum', 'positive'],
  retention_nrr: ['month', 'value'],
  retention_churn: ['month', 'value'],
};

export interface ToolBridge {
  getChartState: () => ChartState;
  applyChartPatch: (chartId: ChartId, patch: Record<string, unknown>) => Promise<ChartState[ChartId]>;
  getFilters: () => ReportFilters;
  applyFilterPatch: (patch: Record<string, unknown>) => Promise<ReportFilters>;
  getTopAccounts: () => { name: string; arr: number }[];
  getAccountMatches: (query: string) => { name: string; arr: number }[];
  getValidAccountNames: () => readonly string[];
  getBusinessDefinitions: () => Promise<SemanticLayerResult>;
  queryBusinessMetric: (query: Record<string, unknown>) => Promise<SemanticLayerResult>;
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
      'Get the active report id, the current knob state of the two agent-editable charts (ARR bridge, retention NRR/churn), the fields available on each, the active report-wide filters (segment, region, planTier, channel, contractType, accountName) which cross-filter all six panels, and a current top-5 account summary. accountName accepts any exact known customer name; use find_account_values for compact discovery beyond the top five.',
      { type: 'object', properties: {} },
      () => ({
        ok: true,
        data: {
          reportId: REPORT_ID, charts: bridge.getChartState(), fields: REPORT_FIELDS,
          filters: bridge.getFilters(), topAccounts: bridge.getTopAccounts(),
        },
      }),
    ),
    tool(
      'list_report_options',
      'List the mark/field allow-list for one or all agent-editable charts, plus the allow-list for the report-wide filters — the only values update_chart_spec and set_report_filters will accept.',
      { type: 'object', properties: { chartId: { type: 'string', enum: CHART_IDS } } },
      (input) => {
        const chartId = input.chartId as ChartId | undefined;
        if (chartId && !CHART_IDS.includes(chartId)) {
          return { ok: false, reason: 'unknown_chart', error: `"${chartId}" is not an agent-editable chart. Valid ids: ${CHART_IDS.join(', ')}.` };
        }
        const charts = chartId ? { [chartId]: CHART_OPTIONS[chartId] } : CHART_OPTIONS;
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
      'get_business_definitions',
      'Get the semantic layer\'s schema: every metric and dimension available across the underlying dataset (MRR, customers, CAC, employees, reports, report views, activity), what each one means, and how the tables relate. Ground an open-ended business question here before answering it or before calling query_business_metric — this is the source of truth for what things mean, separate from the two agent-editable charts.',
      { type: 'object', properties: {} },
      () => bridge.getBusinessDefinitions(),
    ),
    tool(
      'query_business_metric',
      'Run a query against the semantic layer for real numbers behind an open-ended business question — anything outside the two agent-editable charts (e.g. "MRR by region", "report views by owner team"). Pass a Cube query object using measure/dimension names from get_business_definitions: { measures: string[], dimensions?: string[], filters?: object[], timeDimensions?: object[] }.',
      { type: 'object', properties: { query: { type: 'object' } }, required: ['query'] },
      (input) => bridge.queryBusinessMetric(input.query as Record<string, unknown>),
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
  return () => unregisterFns.forEach((fn) => fn?.());
}
