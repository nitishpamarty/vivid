// Connect Data: catalog + schema inference + row fetching for the 7 tables
// seeded by scripts/seed-supabase.mjs, plus the agent-editable chart
// contract for the Explore screen. Mirrors chartState.ts's role for the
// Revenue report's knobs — pure state/logic, no React, no DOM.

import type { VisualizationSpec } from 'vega-embed';
import type { NormalizedQueryContract, QueryDatasetId } from './queryContract.ts';
import { supabase } from './supabase.ts';
import { readEdgeFunctionError } from './edgeFunctionErrors.ts';

export interface DatasetDef {
  id: string;
  table: string;
  label: string;
  orderBy: string[]; // deterministic sort columns, in order
}

export const DATASET_CATALOG: DatasetDef[] = [
  { id: 'customers', table: 'customers', label: 'Customers', orderBy: ['customer_id'] },
  { id: 'mrr_monthly', table: 'mrr_monthly', label: 'MRR (monthly)', orderBy: ['customer_id', 'month'] },
  { id: 'cac_monthly', table: 'cac_monthly', label: 'CAC (monthly)', orderBy: ['month'] },
  { id: 'employees', table: 'employees', label: 'Employees', orderBy: ['employee_id'] },
  { id: 'reports', table: 'reports', label: 'Reports', orderBy: ['report_id'] },
  { id: 'report_views_monthly', table: 'report_views_monthly', label: 'Report views (monthly)', orderBy: ['report_id', 'month'] },
  { id: 'activity_heatmap', table: 'activity_heatmap', label: 'Activity heatmap', orderBy: ['weekday', 'hour_bucket'] },
];

const ROW_LIMIT = 500;

export interface DatasetRows {
  rows: Record<string, unknown>[];
  totalCount: number;
  sampled: boolean;
}

export async function fetchDatasetRows(dataset: DatasetDef): Promise<DatasetRows> {
  let query = supabase.from(dataset.table).select('*', { count: 'exact' });
  for (const col of dataset.orderBy) query = query.order(col);
  const { data, count, error } = await query.limit(ROW_LIMIT);
  if (error) throw new Error(`fetchDatasetRows(${dataset.table}) failed: ${error.message}`);
  const rows = data ?? [];
  const totalCount = count ?? rows.length;
  return { rows, totalCount, sampled: totalCount > rows.length };
}

export interface AggregateQueryMetadata {
  sourceTables: string[];
  relationshipPath: string[];
  truncated: boolean;
  resultCount: number;
  appliedLimits: {
    limit: number;
    offset: number;
    maxSourceRows: number;
    maxResponseBytes: number;
    statementTimeoutMs: number;
  };
}

export interface AggregateQueryData {
  rows: Record<string, unknown>[];
  metadata: AggregateQueryMetadata;
}

export class AggregateQueryError extends Error {
  readonly reason: string;

  constructor(reason: string, message: string) {
    super(message);
    this.name = 'AggregateQueryError';
    this.reason = reason;
  }
}

function isAggregateQueryMetadata(value: unknown): value is AggregateQueryMetadata {
  if (!value || typeof value !== 'object') return false;
  const metadata = value as Record<string, unknown>;
  const limits = metadata.appliedLimits;
  return Array.isArray(metadata.sourceTables)
    && metadata.sourceTables.every((table) => typeof table === 'string')
    && Array.isArray(metadata.relationshipPath)
    && metadata.relationshipPath.every((relationship) => typeof relationship === 'string')
    && typeof metadata.truncated === 'boolean'
    && typeof metadata.resultCount === 'number'
    && Number.isInteger(metadata.resultCount)
    && !!limits
    && typeof limits === 'object'
    && ['limit', 'offset', 'maxSourceRows', 'maxResponseBytes', 'statementTimeoutMs'].every((key) => typeof (limits as Record<string, unknown>)[key] === 'number');
}

/** Execute the validated query through the protected aggregate Edge Function. */
export async function fetchDatasetAggregate(query: NormalizedQueryContract): Promise<AggregateQueryData> {
  const { data, error } = await supabase.functions.invoke('aggregate-query', {
    body: { operation: 'query', query },
  });
  if (error) {
    const safe = await readEdgeFunctionError(error);
    throw new AggregateQueryError(safe?.reason ?? 'unavailable', safe?.error ?? 'Aggregate query service is unavailable. Try again.');
  }
  if (!data || typeof data !== 'object') throw new AggregateQueryError('invalid_response', 'Aggregate query returned no usable result.');
  const envelope = data as { ok?: unknown; reason?: unknown; error?: unknown; data?: unknown };
  if (envelope.ok !== true) {
    const reason = typeof envelope.reason === 'string' ? envelope.reason : 'unavailable';
    const message = reason === 'rate_limited'
      ? 'Aggregate query quota exceeded. Try again shortly.'
      : reason === 'timeout'
        ? 'Aggregate query timed out. Try a smaller query.'
        : reason === 'payload_too_large' || reason === 'limit_exceeded'
          ? 'The aggregate query exceeds the server limits.'
          : typeof envelope.error === 'string' ? envelope.error : 'Aggregate query could not be completed.';
    throw new AggregateQueryError(
      reason,
      message,
    );
  }
  const result = envelope.data as { rows?: unknown; metadata?: unknown } | undefined;
  if (!result || !Array.isArray(result.rows) || !result.rows.every((row) => row && typeof row === 'object' && !Array.isArray(row)) || !isAggregateQueryMetadata(result.metadata)) {
    throw new AggregateQueryError('invalid_response', 'Aggregate query returned an invalid result.');
  }
  return { rows: result.rows as Record<string, unknown>[], metadata: result.metadata };
}

// ---- schema inference ----

export type ColumnType = 'string' | 'number' | 'boolean' | 'date';
export const COLUMN_TYPES: ColumnType[] = ['string', 'number', 'boolean', 'date'];

function looksLikeDate(v: string): boolean {
  return /^\d{4}-\d{2}(-\d{2})?$/.test(v);
}

export function inferColumnTypes(rows: Record<string, unknown>[]): Record<string, ColumnType> {
  const first = rows[0];
  if (!first) return {};
  const types: Record<string, ColumnType> = {};
  for (const [key, value] of Object.entries(first)) {
    if (typeof value === 'boolean') types[key] = 'boolean';
    else if (typeof value === 'number') types[key] = 'number';
    else if (typeof value === 'string' && looksLikeDate(value)) types[key] = 'date';
    else if (typeof value === 'string' && value !== '' && !Number.isNaN(Number(value))) types[key] = 'number';
    else types[key] = 'string';
  }
  return types;
}

// ---- display-type override: presentation-time coercion only, not a schema
// change (see ExploreDashboard.tsx's "this session only" label) ----

export interface CastResult {
  rows: Record<string, unknown>[];
  warnings: Record<string, number>; // failed-cast count per overridden column
}

function castValue(raw: unknown, type: ColumnType): unknown {
  if (raw === null || raw === undefined || raw === '') return null;
  const s = String(raw);
  switch (type) {
    case 'number': {
      const n = Number(s);
      return Number.isNaN(n) ? null : n;
    }
    case 'boolean':
      if (s === 'true' || s === '1') return true;
      if (s === 'false' || s === '0') return false;
      return null;
    case 'date':
      return Number.isNaN(Date.parse(s)) ? null : s;
    case 'string':
    default:
      return s;
  }
}

export function applyDisplayTypeOverrides(
  rows: Record<string, unknown>[],
  overrides: Record<string, ColumnType>,
): CastResult {
  const warnings: Record<string, number> = {};
  const cast = rows.map((row) => {
    const next: Record<string, unknown> = { ...row };
    for (const [col, type] of Object.entries(overrides)) {
      if (!(col in row)) continue;
      const raw = row[col];
      const value = castValue(raw, type);
      if (value === null && raw !== null && raw !== undefined && raw !== '') {
        warnings[col] = (warnings[col] ?? 0) + 1;
      }
      next[col] = value;
    }
    return next;
  });
  return { rows: cast, warnings };
}

// ---- chart contract: what the agent is allowed to author. The app owns
// data.values — the agent never supplies a data source, url, or transform. ----

export const MARK_OPTIONS = ['bar', 'line', 'point', 'arc'] as const;
export type ExploreMark = (typeof MARK_OPTIONS)[number];

// Bump only when the persisted/tool contract shape changes. Older callers may
// omit this field and are normalized to v1 below.
export const CHART_CONTRACT_VERSION = 1 as const;

export const CHANNEL_OPTIONS = ['x', 'y', 'color', 'theta'] as const;
export type ExploreChannel = (typeof CHANNEL_OPTIONS)[number];

export const ENCODING_TYPE_OPTIONS = ['quantitative', 'nominal', 'ordinal', 'temporal'] as const;
export type ExploreEncodingType = (typeof ENCODING_TYPE_OPTIONS)[number];

export const AGGREGATE_OPTIONS = ['sum', 'mean', 'count', 'min', 'max'] as const;
export type ExploreAggregate = (typeof AGGREGATE_OPTIONS)[number];

export interface ExploreEncodingField {
  field: string;
  /** Set only by the canvas composer, and only with an approved relationship path. */
  dataset?: QueryDatasetId;
  type: ExploreEncodingType;
  aggregate?: ExploreAggregate;
  bin?: boolean;
}

export interface ExploreChartContract {
  version: typeof CHART_CONTRACT_VERSION;
  mark: ExploreMark;
  encoding: Partial<Record<ExploreChannel, ExploreEncodingField>>;
  title?: string;
  /** Add safe, app-derived tooltips for the encoded aggregate fields. */
  tooltip?: boolean;
}

export type ContractResult =
  | { ok: true; contract: ExploreChartContract }
  | { ok: false; reason: string; error: string };

const CONTRACT_KEYS = ['version', 'mark', 'encoding', 'title', 'tooltip'];
const CHANNEL_FIELD_KEYS = ['field', 'dataset', 'type', 'aggregate', 'bin'];

export function validateChartContract(input: unknown, columns: string[]): ContractResult {
  if (typeof input !== 'object' || input === null || Array.isArray(input)) {
    return { ok: false, reason: 'invalid_contract', error: 'contract must be an object.' };
  }
  const obj = input as Record<string, unknown>;
  const unknownTop = Object.keys(obj).filter((k) => !CONTRACT_KEYS.includes(k));
  if (unknownTop.length > 0) {
    return { ok: false, reason: 'unknown_field', error: `"${unknownTop.join(', ')}" is not part of the chart contract. The app owns data/transform/config/url — only version, mark, encoding, title, and tooltip are agent-editable.` };
  }
  if (obj.version !== undefined && obj.version !== CHART_CONTRACT_VERSION) {
    return { ok: false, reason: 'invalid_value', error: `"version" must be ${CHART_CONTRACT_VERSION}.` };
  }
  if (!MARK_OPTIONS.includes(obj.mark as ExploreMark)) {
    return { ok: false, reason: 'invalid_value', error: `"mark" must be one of ${MARK_OPTIONS.join(', ')}.` };
  }
  const mark = obj.mark as ExploreMark;

  if (typeof obj.encoding !== 'object' || obj.encoding === null || Array.isArray(obj.encoding)) {
    return { ok: false, reason: 'invalid_contract', error: '"encoding" must be an object keyed by channel (x, y, color, theta).' };
  }
  const encodingIn = obj.encoding as Record<string, unknown>;
  const unknownChannels = Object.keys(encodingIn).filter((k) => !CHANNEL_OPTIONS.includes(k as ExploreChannel));
  if (unknownChannels.length > 0) {
    return { ok: false, reason: 'unknown_field', error: `"${unknownChannels.join(', ')}" is not an editable encoding channel. Valid channels: ${CHANNEL_OPTIONS.join(', ')}.` };
  }

  const encoding: Partial<Record<ExploreChannel, ExploreEncodingField>> = {};
  for (const [channel, raw] of Object.entries(encodingIn)) {
    if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
      return { ok: false, reason: 'invalid_contract', error: `encoding.${channel} must be an object.` };
    }
    const c = raw as Record<string, unknown>;
    const unknownChannelKeys = Object.keys(c).filter((k) => !CHANNEL_FIELD_KEYS.includes(k));
    if (unknownChannelKeys.length > 0) {
      return { ok: false, reason: 'unknown_field', error: `encoding.${channel}."${unknownChannelKeys.join(', ')}" is not editable. Valid keys: ${CHANNEL_FIELD_KEYS.join(', ')}.` };
    }
    if (typeof c.field !== 'string' || !columns.includes(c.field)) {
      return { ok: false, reason: 'invalid_value', error: `encoding.${channel}.field must be one of the active dataset's columns: ${columns.join(', ')}.` };
    }
    if (c.dataset !== undefined && (typeof c.dataset !== 'string' || !Object.prototype.hasOwnProperty.call(DATASET_CATALOG, c.dataset))) {
      return { ok: false, reason: 'invalid_value', error: 'encoding.dataset must be an approved dataset id.' };
    }
    if (!ENCODING_TYPE_OPTIONS.includes(c.type as ExploreEncodingType)) {
      return { ok: false, reason: 'invalid_value', error: `encoding.${channel}.type must be one of ${ENCODING_TYPE_OPTIONS.join(', ')}.` };
    }
    const type = c.type as ExploreEncodingType;
    if (c.aggregate !== undefined) {
      if (!AGGREGATE_OPTIONS.includes(c.aggregate as ExploreAggregate)) {
        return { ok: false, reason: 'invalid_value', error: `encoding.${channel}.aggregate must be one of ${AGGREGATE_OPTIONS.join(', ')}.` };
      }
      if (type !== 'quantitative') {
        return { ok: false, reason: 'invalid_value', error: `encoding.${channel}.aggregate requires type "quantitative".` };
      }
    }
    if (c.bin !== undefined) {
      if (typeof c.bin !== 'boolean') {
        return { ok: false, reason: 'invalid_value', error: `encoding.${channel}.bin must be a boolean.` };
      }
      if (c.bin && type !== 'quantitative') {
        return { ok: false, reason: 'invalid_value', error: `encoding.${channel}.bin requires type "quantitative".` };
      }
    }
    encoding[channel as ExploreChannel] = {
      field: c.field, ...(c.dataset !== undefined ? { dataset: c.dataset as QueryDatasetId } : {}), type,
      ...(c.aggregate !== undefined ? { aggregate: c.aggregate as ExploreAggregate } : {}), ...(c.bin !== undefined ? { bin: c.bin as boolean } : {}),
    };
  }

  if (mark === 'arc') {
    if (!encoding.theta) {
      return { ok: false, reason: 'missing_channel', error: '"arc" requires a "theta" channel.' };
    }
    if (encoding.x || encoding.y) {
      return { ok: false, reason: 'invalid_combination', error: '"arc" supports theta and optional color channels; x and y are not valid.' };
    }
    if (encoding.theta.type !== 'quantitative') {
      return { ok: false, reason: 'invalid_combination', error: '"arc" theta must use a quantitative field.' };
    }
  } else {
    if (!encoding.x || !encoding.y) {
      return { ok: false, reason: 'missing_channel', error: `"${mark}" requires both "x" and "y" channels.` };
    }
    if (encoding.theta) {
      return { ok: false, reason: 'invalid_combination', error: `"${mark}" does not support a theta channel.` };
    }
  }

  if (obj.title !== undefined) {
    if (typeof obj.title !== 'string' || obj.title.length > 80) {
      return { ok: false, reason: 'invalid_value', error: '"title" must be a string of 80 characters or fewer.' };
    }
  }

  if (obj.tooltip !== undefined && typeof obj.tooltip !== 'boolean') {
    return { ok: false, reason: 'invalid_value', error: '"tooltip" must be a boolean.' };
  }

  return {
    ok: true,
    contract: {
      version: CHART_CONTRACT_VERSION,
      mark,
      encoding,
      title: obj.title as string | undefined,
      ...(obj.tooltip !== undefined ? { tooltip: obj.tooltip as boolean } : {}),
    },
  };
}

// x: the string/date column with the fewest distinct values in the sample
// (an id-like column with ~as many distinct values as rows makes an
// unreadable bar chart) — falls back to the first column if none are
// string/date. y: the first number column, summed; a dimension table like
// `customers` has no number column at all, so that falls back to a count
// of x itself, which is always valid.
export function buildDefaultContract(columns: Record<string, ColumnType>, rows: Record<string, unknown>[]): ExploreChartContract {
  const entries = Object.entries(columns);
  const stringish = entries.filter(([, t]) => t === 'string' || t === 'date');
  const cardinality = (col: string) => new Set(rows.map((r) => r[col])).size;
  const [xCol, xType] = stringish.length > 0
    ? stringish.reduce((best, cur) => (cardinality(cur[0]) < cardinality(best[0]) ? cur : best))
    : (entries[0] ?? ['', 'string']);
  const numeric = entries.find(([, t]) => t === 'number');

  return {
    version: CHART_CONTRACT_VERSION,
    mark: 'bar',
    encoding: {
      x: { field: xCol, type: xType === 'date' ? 'temporal' : 'nominal' },
      y: numeric
        ? { field: numeric[0], type: 'quantitative', aggregate: 'sum' }
        : { field: xCol, type: 'quantitative', aggregate: 'count' },
    },
  };
}

// App-owned — never called with agent-supplied data. Only place data.values
// enters a chart the agent can edit.
export function buildVegaLiteSpec(
  contract: ExploreChartContract,
  rows: Record<string, unknown>[],
  fieldAliases: Partial<Record<ExploreChannel, string>> = {},
): VisualizationSpec {
  const encoding: Record<string, unknown> = {};
  for (const [channel, field] of Object.entries(contract.encoding)) {
    if (!field) continue;
    const alias = fieldAliases[channel as ExploreChannel];
    // Aggregate queries already return one row per group. Keep aggregate/bin
    // in the raw-row mode, but never ask Vega-Lite to aggregate the result a
    // second time when a server output alias is present.
    // dataset is a query-contract provenance hint, not a Vega encoding key.
    const { aggregate, bin, dataset: _dataset, ...base } = field;
    encoding[channel] = alias
      ? { ...base, field: alias }
      : { ...base, ...(aggregate !== undefined ? { aggregate } : {}), ...(bin !== undefined ? { bin } : {}) };
  }
  if (contract.tooltip) {
    encoding.tooltip = Object.values(encoding).map((field) => ({ ...(field as Record<string, unknown>) }));
  }
  return {
    data: { values: rows },
    mark: contract.mark,
    encoding,
    ...(contract.title ? { title: contract.title } : {}),
  } as VisualizationSpec;
}
