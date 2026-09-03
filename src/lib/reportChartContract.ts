export type ReportChartContract =
  | { version: 1; chartId: 'arr_mix'; presentation: 'donut' | 'bar' }
  | { version: 1; chartId: 'top_accounts'; presentation: 'ranked_list' | 'bar' }
  | { version: 1; chartId: 'net_new_logos'; presentation: 'heatmap' | 'bar' }
  | { version: 1; chartId: 'arr_bridge'; presentation: 'waterfall' }
  | { version: 1; chartId: 'retention_nrr'; presentation: 'line' }
  | { version: 1; chartId: 'retention_churn'; presentation: 'line' };

export type ReportChartId = ReportChartContract['chartId'];
export type ContractFor<K extends ReportChartId> = Extract<ReportChartContract, { chartId: K }>;
export type ReportChartContracts = { [K in ReportChartId]: ContractFor<K> };

export const REPORT_CHART_IDS: ReportChartId[] = [
  'arr_mix', 'top_accounts', 'net_new_logos', 'arr_bridge', 'retention_nrr', 'retention_churn',
];

type RendererId =
  | 'arr_mix_donut' | 'arr_mix_bar'
  | 'top_accounts_ranked_list' | 'top_accounts_bar'
  | 'net_new_logos_heatmap' | 'net_new_logos_bar'
  | 'arr_bridge_waterfall' | 'retention_nrr_line' | 'retention_churn_line';

export type ReportChartValidationResult<T = ReportChartContract> =
  | { ok: true; data: T }
  | { ok: false; reason: string; error: string };

export interface RevenueChartAdapter<K extends ReportChartId> {
  chartId: K;
  default: ContractFor<K>;
  presentations: readonly ContractFor<K>['presentation'][];
  validate: (input: unknown) => ReportChartValidationResult<ContractFor<K>>;
  renderer: (contract: ContractFor<K>) => RendererId;
  invariant: string;
}

const keys = ['version', 'chartId', 'presentation'];

function objectInput(input: unknown): Record<string, unknown> | null {
  return typeof input === 'object' && input !== null && !Array.isArray(input)
    ? input as Record<string, unknown>
    : null;
}

function invalid(error: string, reason = 'invalid_contract'): ReportChartValidationResult {
  return { ok: false, reason, error };
}

function validateFor<K extends ReportChartId>(chartId: K, presentations: readonly string[], input: unknown): ReportChartValidationResult<ContractFor<K>> {
  const value = objectInput(input);
  if (!value) return invalid('contract must be an object with exactly version, chartId, and presentation.') as ReportChartValidationResult<ContractFor<K>>;
  const unknownKeys = Object.keys(value).filter((key) => !keys.includes(key));
  if (unknownKeys.length > 0) return invalid(`Unknown contract field(s): ${unknownKeys.join(', ')}.`, 'unknown_field') as ReportChartValidationResult<ContractFor<K>>;
  if (value.version !== 1) return invalid('contract.version must be 1.', 'invalid_value') as ReportChartValidationResult<ContractFor<K>>;
  if (value.chartId !== chartId) return invalid(`contract.chartId must be "${chartId}".`, 'unknown_chart') as ReportChartValidationResult<ContractFor<K>>;
  if (typeof value.presentation !== 'string' || !presentations.includes(value.presentation)) {
    return invalid(`contract.presentation must be one of ${presentations.join(', ')}.`, 'invalid_value') as ReportChartValidationResult<ContractFor<K>>;
  }
  return { ok: true, data: { version: 1, chartId, presentation: value.presentation } as ContractFor<K> };
}

const ARR_MIX: RevenueChartAdapter<'arr_mix'> = {
  chartId: 'arr_mix', default: { version: 1, chartId: 'arr_mix', presentation: 'donut' }, presentations: ['donut', 'bar'],
  validate: (input) => validateFor('arr_mix', ['donut', 'bar'], input),
  renderer: (contract) => contract.presentation === 'donut' ? 'arr_mix_donut' : 'arr_mix_bar',
  invariant: 'Acquisition-channel ARR, labels, percentages, colors, and click-to-filter semantics remain unchanged.',
};

const TOP_ACCOUNTS: RevenueChartAdapter<'top_accounts'> = {
  chartId: 'top_accounts', default: { version: 1, chartId: 'top_accounts', presentation: 'ranked_list' }, presentations: ['ranked_list', 'bar'],
  validate: (input) => validateFor('top_accounts', ['ranked_list', 'bar'], input),
  renderer: (contract) => contract.presentation === 'ranked_list' ? 'top_accounts_ranked_list' : 'top_accounts_bar',
  invariant: 'Customer name and current ARR stay fixed; the list remains the filtered top five except accountName.',
};

const NET_NEW_LOGOS: RevenueChartAdapter<'net_new_logos'> = {
  chartId: 'net_new_logos', default: { version: 1, chartId: 'net_new_logos', presentation: 'heatmap' }, presentations: ['heatmap', 'bar'],
  validate: (input) => validateFor('net_new_logos', ['heatmap', 'bar'], input),
  renderer: (contract) => contract.presentation === 'heatmap' ? 'net_new_logos_heatmap' : 'net_new_logos_bar',
  invariant: 'Region net-new-logo values use the existing trailing six-month window; the heatmap remains diverging.',
};

const ARR_BRIDGE: RevenueChartAdapter<'arr_bridge'> = {
  chartId: 'arr_bridge', default: { version: 1, chartId: 'arr_bridge', presentation: 'waterfall' }, presentations: ['waterfall'],
  validate: (input) => validateFor('arr_bridge', ['waterfall'], input),
  renderer: () => 'arr_bridge_waterfall',
  invariant: 'The existing floating waterfall and ARR-bridge metric are fixed; no bar/line or dual-axis alternative.',
};

const RETENTION_NRR: RevenueChartAdapter<'retention_nrr'> = {
  chartId: 'retention_nrr', default: { version: 1, chartId: 'retention_nrr', presentation: 'line' }, presentations: ['line'],
  validate: (input) => validateFor('retention_nrr', ['line'], input),
  renderer: () => 'retention_nrr_line',
  invariant: 'NRR remains its own small-multiple line chart with the existing calculation and window behavior.',
};

const RETENTION_CHURN: RevenueChartAdapter<'retention_churn'> = {
  chartId: 'retention_churn', default: { version: 1, chartId: 'retention_churn', presentation: 'line' }, presentations: ['line'],
  validate: (input) => validateFor('retention_churn', ['line'], input),
  renderer: () => 'retention_churn_line',
  invariant: 'Churn remains a separate small-multiple line chart with its own axis and existing calculation and window behavior.',
};

export const REVENUE_CHART_REGISTRY: { [K in ReportChartId]: RevenueChartAdapter<K> } = {
  arr_mix: ARR_MIX,
  top_accounts: TOP_ACCOUNTS,
  net_new_logos: NET_NEW_LOGOS,
  arr_bridge: ARR_BRIDGE,
  retention_nrr: RETENTION_NRR,
  retention_churn: RETENTION_CHURN,
};

export const DEFAULT_REPORT_CHART_CONTRACTS: ReportChartContracts = {
  arr_mix: ARR_MIX.default,
  top_accounts: TOP_ACCOUNTS.default,
  net_new_logos: NET_NEW_LOGOS.default,
  arr_bridge: ARR_BRIDGE.default,
  retention_nrr: RETENTION_NRR.default,
  retention_churn: RETENTION_CHURN.default,
};

export function validateReportChartContract(input: unknown): ReportChartValidationResult {
  const value = objectInput(input);
  if (!value) return invalid('contract must be an object with exactly version, chartId, and presentation.');
  if (typeof value.chartId !== 'string' || !REPORT_CHART_IDS.includes(value.chartId as ReportChartId)) {
    return invalid(`"${String(value.chartId ?? '')}" is not a Revenue chart id. Valid ids: ${REPORT_CHART_IDS.join(', ')}.`, 'unknown_chart');
  }
  const adapter = REVENUE_CHART_REGISTRY[value.chartId as ReportChartId];
  return adapter.validate(input);
}

export function validateReportChartContracts(input: unknown): ReportChartValidationResult<ReportChartContracts> {
  const value = objectInput(input);
  if (!value) return invalid('chartContracts must be an object keyed by every Revenue chart id.') as ReportChartValidationResult<ReportChartContracts>;
  const unknownIds = Object.keys(value).filter((id) => !REPORT_CHART_IDS.includes(id as ReportChartId));
  const missingIds = REPORT_CHART_IDS.filter((id) => !Object.prototype.hasOwnProperty.call(value, id));
  if (unknownIds.length > 0) return invalid(`Unknown chart contract id(s): ${unknownIds.join(', ')}.`, 'unknown_chart') as ReportChartValidationResult<ReportChartContracts>;
  if (missingIds.length > 0) return invalid(`Missing chart contract id(s): ${missingIds.join(', ')}.`, 'invalid_contract') as ReportChartValidationResult<ReportChartContracts>;
  const contracts = {} as ReportChartContracts;
  for (const id of REPORT_CHART_IDS) {
    const result = validateReportChartContract(value[id]);
    if (!result.ok) return result as ReportChartValidationResult<ReportChartContracts>;
    if (result.data.chartId !== id) return invalid(`chartContracts.${id}.chartId must be "${id}".`, 'unknown_chart') as ReportChartValidationResult<ReportChartContracts>;
    Object.assign(contracts, { [id]: result.data });
  }
  return { ok: true, data: contracts };
}

export function reportChartOptions() {
  return REPORT_CHART_IDS.map((chartId) => {
    const adapter = REVENUE_CHART_REGISTRY[chartId];
    const renderer = adapter.renderer as (contract: ReportChartContract) => RendererId;
    return {
      chartId,
      default: adapter.default,
      presentations: adapter.presentations,
      renderers: adapter.presentations.map((presentation) => renderer({ version: 1, chartId, presentation } as ReportChartContract)),
      invariant: adapter.invariant,
    };
  });
}
