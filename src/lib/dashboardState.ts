import { DEFAULT_FILTERS, type ReportFilters } from './reportFilters.ts';
import { DEFAULT_CHART_STATE, type ChartState } from './chartValidation.ts';
import {
  DEFAULT_REPORT_CHART_CONTRACTS, validateReportChartContracts,
  type ReportChartContracts,
} from './reportChartContract.ts';

export interface DashboardState {
  charts: ChartState;
  filters: ReportFilters;
  chartContracts: ReportChartContracts;
}

export const DEFAULT_DASHBOARD_STATE: DashboardState = {
  charts: DEFAULT_CHART_STATE,
  filters: DEFAULT_FILTERS,
  chartContracts: DEFAULT_REPORT_CHART_CONTRACTS,
};

export const DASHBOARD_SCHEMA_VERSION = 5;

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export type DashboardStateDecodeResult =
  | { ok: true; data: DashboardState }
  | { ok: false; reason: string; error: string };

export function decodeDashboardState(value: unknown, schemaVersion: number): DashboardStateDecodeResult {
  if (!isObject(value) || !isObject(value.charts) || !isObject(value.filters)) {
    return { ok: false, reason: 'invalid_state', error: 'Shared dashboard state is invalid.' };
  }
  const allowedKeys = schemaVersion === 4 ? ['charts', 'filters'] : ['charts', 'filters', 'chartContracts'];
  if (Object.keys(value).some((key) => !allowedKeys.includes(key))) {
    return { ok: false, reason: 'unknown_field', error: 'Shared dashboard state contains an unknown field.' };
  }
  if (schemaVersion === 4) {
    return { ok: true, data: { charts: value.charts as ChartState, filters: value.filters as ReportFilters, chartContracts: DEFAULT_REPORT_CHART_CONTRACTS } };
  }
  if (schemaVersion !== DASHBOARD_SCHEMA_VERSION) {
    return { ok: false, reason: 'invalid_state', error: 'Shared dashboard state version is unavailable.' };
  }
  const contracts = validateReportChartContracts(value.chartContracts);
  if (!contracts.ok) return { ok: false, reason: contracts.reason, error: contracts.error };
  return { ok: true, data: { charts: value.charts as ChartState, filters: value.filters as ReportFilters, chartContracts: contracts.data } };
}
