// Phase 2: the two agent-editable panels' state, expressed as data (knobs),
// never as raw Vega-Lite JSON. A chart's spec is *derived* from these knobs
// (see vegaSpecs.ts) — this is the "chart-as-data not chart-as-code" state
// that persistence, undo, and the WebMCP tools all operate on.

import { PALETTE, BRAND } from './palette.ts';
import { DEFAULT_FILTERS, type ReportFilters } from './reportFilters.ts';
import { supabase } from './supabase.ts';
import type { Region, Segment } from './types.ts';

export type ChartId = 'arr_bridge' | 'retention_nrr' | 'retention_churn';
export const CHART_IDS: ChartId[] = ['arr_bridge', 'retention_nrr', 'retention_churn'];

export type SwatchKey = 'good' | 'critical' | 'brand' | 'cat2' | 'cat3';
export const SWATCH_KEYS: SwatchKey[] = ['good', 'critical', 'brand', 'cat2', 'cat3'];

const SWATCH_HEX: Record<SwatchKey, string> = {
  good: PALETTE.good, critical: PALETTE.critical, brand: BRAND, cat2: PALETTE.cat2, cat3: PALETTE.cat3,
};
export function swatchHex(key: SwatchKey): string {
  return SWATCH_HEX[key];
}

export type WindowMonths = 6 | 12 | 24;
export const WINDOW_OPTIONS: WindowMonths[] = [6, 12, 24];

export interface ArrBridgeKnobs {
  windowMonths: WindowMonths;
  positiveColor: SwatchKey;
  negativeColor: SwatchKey;
  barWidth: number; // band fraction, 0.4-0.8
}

export interface RetentionLineKnobs {
  windowMonths: WindowMonths;
  lineColor: SwatchKey;
}

export interface ChartState {
  arr_bridge: ArrBridgeKnobs;
  retention_nrr: RetentionLineKnobs;
  retention_churn: RetentionLineKnobs;
}

export const DEFAULT_CHART_STATE: ChartState = {
  arr_bridge: { windowMonths: 12, positiveColor: 'good', negativeColor: 'critical', barWidth: 0.62 },
  retention_nrr: { windowMonths: 12, lineColor: 'brand' },
  retention_churn: { windowMonths: 12, lineColor: 'critical' },
};

// The mark/encoding/field allow-list per chart — the single source of truth
// for both list_report_options and update_chart_spec's validator.
type FieldOption =
  | { type: 'enum'; values: readonly (string | number)[] }
  | { type: 'range'; min: number; max: number; step: number };

interface ChartOptions {
  mark: string; // fixed — never a patchable field, enforces the "never dual-axis" invariants
  fields: Record<string, FieldOption>;
}

const BRIDGE_FIELDS: Record<keyof ArrBridgeKnobs, FieldOption> = {
  windowMonths: { type: 'enum', values: WINDOW_OPTIONS },
  positiveColor: { type: 'enum', values: SWATCH_KEYS },
  negativeColor: { type: 'enum', values: SWATCH_KEYS },
  barWidth: { type: 'range', min: 0.4, max: 0.8, step: 0.02 },
};

const LINE_FIELDS: Record<keyof RetentionLineKnobs, FieldOption> = {
  windowMonths: { type: 'enum', values: WINDOW_OPTIONS },
  lineColor: { type: 'enum', values: SWATCH_KEYS },
};

export const CHART_OPTIONS: Record<ChartId, ChartOptions> = {
  arr_bridge: { mark: 'bar', fields: BRIDGE_FIELDS },
  retention_nrr: { mark: 'line', fields: LINE_FIELDS },
  retention_churn: { mark: 'line', fields: LINE_FIELDS },
};

export type PatchResult =
  | { ok: true }
  | { ok: false; reason: string; error: string };

export function validatePatch(chartId: string, patch: unknown): PatchResult {
  if (!CHART_IDS.includes(chartId as ChartId)) {
    return { ok: false, reason: 'unknown_chart', error: `"${chartId}" is not an agent-editable chart. Valid ids: ${CHART_IDS.join(', ')}.` };
  }
  if (typeof patch !== 'object' || patch === null || Array.isArray(patch)) {
    return { ok: false, reason: 'invalid_patch', error: 'patch must be an object of field: value pairs.' };
  }
  const entries = Object.entries(patch as Record<string, unknown>);
  if (entries.length === 0) {
    return { ok: false, reason: 'empty_patch', error: 'patch has no fields to apply.' };
  }
  const options = CHART_OPTIONS[chartId as ChartId].fields;
  for (const [key, value] of entries) {
    const opt = options[key];
    if (!opt) {
      return { ok: false, reason: 'unknown_field', error: `"${key}" is not editable on ${chartId}. Editable fields: ${Object.keys(options).join(', ')}.` };
    }
    if (opt.type === 'enum' && !opt.values.includes(value as string | number)) {
      return { ok: false, reason: 'invalid_value', error: `"${key}" must be one of ${opt.values.join(', ')}, got ${JSON.stringify(value)}.` };
    }
    if (opt.type === 'range') {
      const steps = (value as number - opt.min) / opt.step;
      const offStep = typeof value !== 'number' || Number.isNaN(steps) || Math.abs(steps - Math.round(steps)) > 1e-9;
      if (typeof value !== 'number' || value < opt.min || value > opt.max || offStep) {
        return { ok: false, reason: 'invalid_value', error: `"${key}" must be a multiple of ${opt.step} between ${opt.min} and ${opt.max}, got ${JSON.stringify(value)}.` };
      }
    }
  }
  return { ok: true };
}

// ---- whole-dashboard state: the two chart panels' knobs + the report-wide filters ----
// One persisted/undo unit, since both are "edits to the dashboard" a viewer
// or the agent can make.

export interface DashboardState {
  charts: ChartState;
  filters: ReportFilters;
}

export const DEFAULT_DASHBOARD_STATE: DashboardState = { charts: DEFAULT_CHART_STATE, filters: DEFAULT_FILTERS };

// ---- Supabase persistence: one row per report id, schema-versioned, realtime-synced across viewers ----

const SCHEMA_VERSION = 4; // v2 added `filters`; v3 added `filters.accountName`; v4 added `filters.channel`/`filters.contractType` — older rows are rejected below, not migrated
const REPORT_ID = 'northbeam';

export async function loadDashboardState(reportId: string = REPORT_ID): Promise<DashboardState> {
  const { data, error } = await supabase
    .from('dashboard_state')
    .select('schema_version, state')
    .eq('report_id', reportId)
    .maybeSingle();
  if (error || !data || data.schema_version !== SCHEMA_VERSION) return DEFAULT_DASHBOARD_STATE;
  return data.state as DashboardState;
}

export function saveDashboardState(state: DashboardState, actor: 'person' | 'agent', reportId: string = REPORT_ID): void {
  supabase
    .from('dashboard_state')
    .update({ state, updated_by: actor, updated_at: new Date().toISOString() })
    .eq('report_id', reportId)
    .then(({ error }) => {
      // ponytail: best-effort — a dropped write just means the next edit re-syncs from local state; not load-bearing for the demo
      if (error) console.error('saveDashboardState failed', error);
    });
}

// Pushes every remote update (including this client's own, echoed back) — cheap no-op when it matches what's already local.
export function subscribeDashboardState(onChange: (state: DashboardState) => void, reportId: string = REPORT_ID): () => void {
  const channel = supabase
    .channel(`dashboard_state:${reportId}`)
    .on(
      'postgres_changes',
      { event: 'UPDATE', schema: 'public', table: 'dashboard_state', filter: `report_id=eq.${reportId}` },
      (payload) => onChange(payload.new.state as DashboardState),
    )
    .subscribe();
  return () => { supabase.removeChannel(channel); };
}

export { REPORT_ID };

// ---- find_field_values: phrase -> canonical field value, always a best guess ----

const COLOR_SYNONYMS: Record<string, SwatchKey> = {
  green: 'good', good: 'good', positive: 'good',
  red: 'critical', crimson: 'critical', critical: 'critical', negative: 'critical',
  blue: 'brand', navy: 'brand', brand: 'brand',
  orange: 'cat2', amber: 'cat2', cat2: 'cat2',
  teal: 'cat3', emerald: 'cat3', cat3: 'cat3',
};

const WORD_NUMBERS: Record<string, number> = { six: 6, twelve: 12, twenty: 20, 'twenty-four': 24, one: 1, two: 2, a: 1 };

const REGION_SYNONYMS: Record<string, Region> = {
  na: 'NA', 'north america': 'NA', us: 'NA', usa: 'NA',
  emea: 'EMEA', europe: 'EMEA',
  apac: 'APAC', asia: 'APAC',
  latam: 'LATAM', 'latin america': 'LATAM',
};

const SEGMENT_SYNONYMS: Record<string, Segment> = {
  smb: 'SMB', 'small business': 'SMB', startup: 'SMB', startups: 'SMB',
  'mid-market': 'Mid-Market', midmarket: 'Mid-Market', 'mid market': 'Mid-Market',
  enterprise: 'Enterprise',
};

export interface FieldGuess {
  field: 'color' | 'windowMonths' | 'segment' | 'region';
  value: SwatchKey | WindowMonths | Segment | Region;
}

function nearestWindow(n: number): WindowMonths {
  return WINDOW_OPTIONS.reduce((best, w) => (Math.abs(w - n) < Math.abs(best - n) ? w : best));
}

// Plain .includes() false-positives constantly on short synonyms — "us" (→
// NA) matched inside "just" and "customers" during testing. Word-boundary
// matching is the root-cause fix, applied to every synonym table here, not
// just the one that got caught.
function hasWord(haystack: string, word: string): boolean {
  return new RegExp(`\\b${word.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`).test(haystack);
}

export function findFieldValue(phrase: string): FieldGuess {
  const p = phrase.trim().toLowerCase();

  for (const [word, region] of Object.entries(REGION_SYNONYMS)) {
    if (hasWord(p, word)) return { field: 'region', value: region };
  }

  for (const [word, segment] of Object.entries(SEGMENT_SYNONYMS)) {
    if (hasWord(p, word)) return { field: 'segment', value: segment };
  }

  for (const [word, key] of Object.entries(COLOR_SYNONYMS)) {
    if (hasWord(p, word)) return { field: 'color', value: key };
  }

  const digitMatch = p.match(/\d+/);
  const num = digitMatch
    ? Number(digitMatch[0])
    // longest key first, so "twenty-four" is tried before the "twenty" prefix it contains
    : Object.entries(WORD_NUMBERS).sort((a, b) => b[0].length - a[0].length).find(([word]) => hasWord(p, word))?.[1];

  if (num !== undefined) {
    const months = /\byears?\b/.test(p) ? num * 12 : num;
    return { field: 'windowMonths', value: nearestWindow(months) };
  }

  return { field: 'windowMonths', value: 12 };
}
