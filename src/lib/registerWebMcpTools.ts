import {
  CHART_IDS, CHART_OPTIONS, REPORT_ID, findFieldValue, validatePatch,
  type ChartId, type ChartState,
} from './chartState';
import { FILTER_OPTIONS, validateFilterPatch, type ReportFilters } from './reportFilters';

const REPORT_FIELDS: Record<ChartId, string[]> = {
  arr_bridge: ['label', 'month', 'delta', 'priorCum', 'newCum', 'positive'],
  retention_nrr: ['month', 'value'],
  retention_churn: ['month', 'value'],
};

export interface ToolBridge {
  getChartState: () => ChartState;
  applyChartPatch: (chartId: ChartId, patch: Record<string, unknown>) => ChartState[ChartId];
  getFilters: () => ReportFilters;
  applyFilterPatch: (patch: Record<string, unknown>) => ReportFilters;
  getTopAccounts: () => { name: string; arr: number }[];
  getValidAccountNames: () => readonly string[];
  logAgent: (message: string) => void;
}

function describeCall(name: string, input: Record<string, unknown>): string {
  const patch = input.patch as Record<string, unknown> | undefined;
  const summary = patch && Object.entries(patch).map(([k, v]) => `${k}=${v}`).join(', ');
  if (name === 'update_chart_spec') return `updated ${input.chartId}: ${summary}`;
  if (name === 'set_report_filters') return `filtered: ${summary}`;
  return `called ${name}`;
}

function tool(name: string, description: string, inputSchema: Record<string, unknown>, run: (input: Record<string, unknown>) => unknown, bridge: ToolBridge) {
  return {
    name,
    description,
    inputSchema,
    execute: (input: Record<string, unknown>) => {
      const result = run(input ?? {});
      const r = result as { ok: boolean; reason?: string };
      bridge.logAgent(r.ok ? describeCall(name, input ?? {}) : `called ${name} (rejected: ${r.reason})`);
      return result;
    },
  };
}

export function registerNorthbeamTools(bridge: ToolBridge): () => void {
  if (typeof document === 'undefined' || !document.modelContext) return () => {};

  const tools = [
    tool(
      'get_report_context',
      'Get the active report id, the current knob state of the two agent-editable charts (ARR bridge, retention NRR/churn), the fields available on each, the active report-wide filters (segment, region, planTier, channel, contractType, accountName) which cross-filter all six panels, and the current top-5 accounts (name + ARR) — the exact name strings set_report_filters.accountName accepts.',
      { type: 'object', properties: {} },
      () => ({
        ok: true,
        data: {
          reportId: REPORT_ID, charts: bridge.getChartState(), fields: REPORT_FIELDS,
          filters: bridge.getFilters(), topAccounts: bridge.getTopAccounts(),
        },
      }),
      bridge,
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
      bridge,
    ),
    tool(
      'update_chart_spec',
      'Apply a validated patch (field: value pairs from list_report_options) to one agent-editable chart. Atomic replace — the whole chart re-renders from the new knob state or nothing changes.',
      {
        type: 'object',
        properties: { chartId: { type: 'string', enum: CHART_IDS }, patch: { type: 'object' } },
        required: ['chartId', 'patch'],
      },
      (input) => {
        const chartId = input.chartId as string;
        const patch = input.patch as Record<string, unknown>;
        const validation = validatePatch(chartId, patch);
        if (!validation.ok) return { ok: false, reason: validation.reason, error: validation.error };
        const data = bridge.applyChartPatch(chartId as ChartId, patch);
        return { ok: true, data };
      },
      bridge,
    ),
    tool(
      'set_report_filters',
      'Set one or more report-wide filters (segment, region, planTier, channel, contractType from list_report_options; accountName is a free-text customer name from get_report_context\'s topAccounts, for drilling into a single account). Cross-filters all six panels, including the four non-Vega ones. Use "all" to clear a filter. Validated patch, atomic replace.',
      { type: 'object', properties: { patch: { type: 'object' } }, required: ['patch'] },
      (input) => {
        const patch = input.patch as Record<string, unknown>;
        const validation = validateFilterPatch(patch, bridge.getValidAccountNames());
        if (!validation.ok) return { ok: false, reason: validation.reason, error: validation.error };
        const data = bridge.applyFilterPatch(patch);
        return { ok: true, data };
      },
      bridge,
    ),
    tool(
      'find_field_values',
      'Resolve a free-text phrase (a color name, a time range, a segment or region name) to the canonical field/value pair update_chart_spec or set_report_filters expects. Always returns its best guess — never asks for clarification.',
      { type: 'object', properties: { phrase: { type: 'string' } }, required: ['phrase'] },
      (input) => {
        const phrase = String(input.phrase ?? '');
        return { ok: true, data: findFieldValue(phrase) };
      },
      bridge,
    ),
  ];

  const unregisterFns = tools.map((t) => document.modelContext!.registerTool(t));
  return () => unregisterFns.forEach((fn) => fn?.());
}
