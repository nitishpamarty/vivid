// Connect Data: catalog + schema inference + row fetching for the 7 tables
// seeded by scripts/seed-supabase.mjs, plus the agent-editable chart
// contract for the Explore screen. Mirrors chartState.ts's role for the
// Revenue report's knobs — pure state/logic, no React, no DOM.

import type { VisualizationSpec } from 'vega-embed';
import { supabase } from './supabase';

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

export const CHANNEL_OPTIONS = ['x', 'y', 'color', 'theta'] as const;
export type ExploreChannel = (typeof CHANNEL_OPTIONS)[number];

export const ENCODING_TYPE_OPTIONS = ['quantitative', 'nominal', 'ordinal', 'temporal'] as const;
export type ExploreEncodingType = (typeof ENCODING_TYPE_OPTIONS)[number];

export const AGGREGATE_OPTIONS = ['sum', 'mean', 'count', 'min', 'max'] as const;
export type ExploreAggregate = (typeof AGGREGATE_OPTIONS)[number];

export interface ExploreEncodingField {
  field: string;
  type: ExploreEncodingType;
  aggregate?: ExploreAggregate;
  bin?: boolean;
}

export interface ExploreChartContract {
  mark: ExploreMark;
  encoding: Partial<Record<ExploreChannel, ExploreEncodingField>>;
  title?: string;
}

export type ContractResult =
  | { ok: true; contract: ExploreChartContract }
  | { ok: false; reason: string; error: string };

const CONTRACT_KEYS = ['mark', 'encoding', 'title'];
const CHANNEL_FIELD_KEYS = ['field', 'type', 'aggregate', 'bin'];

export function validateChartContract(input: unknown, columns: string[]): ContractResult {
  if (typeof input !== 'object' || input === null || Array.isArray(input)) {
    return { ok: false, reason: 'invalid_contract', error: 'contract must be an object.' };
  }
  const obj = input as Record<string, unknown>;
  const unknownTop = Object.keys(obj).filter((k) => !CONTRACT_KEYS.includes(k));
  if (unknownTop.length > 0) {
    return { ok: false, reason: 'unknown_field', error: `"${unknownTop.join(', ')}" is not part of the chart contract. The app owns data/transform/config — only mark, encoding, and title are agent-editable.` };
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
      field: c.field, type, ...(c.aggregate !== undefined ? { aggregate: c.aggregate as ExploreAggregate } : {}), ...(c.bin !== undefined ? { bin: c.bin as boolean } : {}),
    };
  }

  if (mark === 'arc' && !encoding.theta) {
    return { ok: false, reason: 'missing_channel', error: '"arc" requires a "theta" channel.' };
  }
  if (mark !== 'arc' && (!encoding.x || !encoding.y)) {
    return { ok: false, reason: 'missing_channel', error: `"${mark}" requires both "x" and "y" channels.` };
  }

  if (obj.title !== undefined) {
    if (typeof obj.title !== 'string' || obj.title.length > 80) {
      return { ok: false, reason: 'invalid_value', error: '"title" must be a string of 80 characters or fewer.' };
    }
  }

  return { ok: true, contract: { mark, encoding, title: obj.title as string | undefined } };
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
export function buildVegaLiteSpec(contract: ExploreChartContract, rows: Record<string, unknown>[]): VisualizationSpec {
  const encoding: Record<string, unknown> = {};
  for (const [channel, field] of Object.entries(contract.encoding)) {
    if (!field) continue;
    encoding[channel] = field;
  }
  return {
    data: { values: rows },
    mark: contract.mark,
    encoding,
    ...(contract.title ? { title: contract.title } : {}),
  } as VisualizationSpec;
}
