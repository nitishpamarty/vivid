// Phase 2: the two agent-editable panels' state, expressed as data (knobs),
// never as raw Vega-Lite JSON. A chart's spec is *derived* from these knobs
// (see vegaSpecs.ts) — this is the "chart-as-data not chart-as-code" state
// that persistence, undo, and the WebMCP tools all operate on.

import { supabase } from './supabase.ts';
import type { Region, Segment } from './types.ts';
import {
  DASHBOARD_SCHEMA_VERSION, DEFAULT_DASHBOARD_STATE, decodeDashboardState,
  type DashboardState,
} from './dashboardState.ts';
export {
  DEFAULT_REPORT_CHART_CONTRACTS, REPORT_CHART_IDS, validateReportChartContract, validateReportChartContracts,
  type ReportChartContract, type ReportChartContracts, type ReportChartId,
} from './reportChartContract.ts';
export { DASHBOARD_SCHEMA_VERSION, DEFAULT_DASHBOARD_STATE, decodeDashboardState, type DashboardState, type DashboardStateDecodeResult } from './dashboardState.ts';
export {
  CHART_IDS, CHART_OPTIONS, DEFAULT_CHART_STATE, SWATCH_KEYS, WINDOW_OPTIONS, swatchHex, validatePatch,
  type ArrBridgeKnobs, type ChartId, type ChartState, type PatchResult, type RetentionLineKnobs, type SwatchKey,
  type WindowMonths,
} from './chartValidation.ts';
import { WINDOW_OPTIONS, type ChartId, type SwatchKey, type WindowMonths } from './chartValidation.ts';

// Static chart id -> Cube member name ("<cube>.<field>", matching
// semanticMetadata.ts's memberName()) so WebMCP tools can hand the agent a
// key it can pass straight to the semantic-layer tools. Each chart is a
// derived metric (bridge/trailing-window math over several cube fields, see
// metrics.ts), not a single Cube measure, so this picks the cube measure
// that best represents each chart's headline number — a judgment call, not
// a 1:1 lookup.
export const CHART_METRIC_KEYS: Record<ChartId, string> = {
  arr_bridge: 'mrr_monthly.total_mrr',
  retention_nrr: 'mrr_monthly.total_mrr',
  retention_churn: 'mrr_monthly.churned_customers',
};

// ---- Supabase reads: room-scoped, versioned, realtime-synced across viewers ----

const SCHEMA_VERSION = DASHBOARD_SCHEMA_VERSION;
const REPORT_ID = 'northbeam';

export interface DashboardSnapshot {
  state: DashboardState;
  version: number;
}

export async function loadDashboardSnapshot(reportId: string = REPORT_ID, roomId?: string): Promise<DashboardSnapshot> {
  if (!roomId) return { state: DEFAULT_DASHBOARD_STATE, version: 0 };
  const { data, error } = await supabase
    .from('dashboard_state')
    .select('schema_version, version, state')
    .eq('report_id', reportId)
    .eq('room_id', roomId)
    .maybeSingle();
  if (error) throw new Error('Shared dashboard is unavailable.');
  if (!data || ![4, SCHEMA_VERSION].includes(data.schema_version) || typeof data.version !== 'number') {
    throw new Error('Shared dashboard state is unavailable.');
  }
  const decoded = decodeDashboardState(data.state, data.schema_version);
  if (!decoded.ok) throw new Error('Shared dashboard state is unavailable.');
  return { state: decoded.data, version: data.version };
}

export async function loadDashboardState(reportId: string = REPORT_ID, roomId?: string): Promise<DashboardState> {
  return (await loadDashboardSnapshot(reportId, roomId)).state;
}

// Pushes every remote update (including this client's own, echoed back).
export function subscribeDashboardState(onChange: (state: DashboardState, version: number) => void, reportId: string = REPORT_ID, roomId?: string, onStatus?: (status: 'subscribed' | 'unavailable') => void): () => void {
  if (!roomId) return () => {};
  const channel = supabase
    .channel(`dashboard_state:${roomId}:${reportId}`)
    .on(
      'postgres_changes',
      { event: 'UPDATE', schema: 'public', table: 'dashboard_state', filter: `room_id=eq.${roomId}` },
      (payload) => {
        // The table now also carries `product_usage` rows for the same room
        // (Phase: Product Usage shared persistence) — ignore updates for any
        // report id other than this subscription's own.
        if (payload.new.report_id !== reportId) return;
        const decoded = decodeDashboardState(payload.new.state, Number(payload.new.schema_version));
        if (decoded.ok) onChange(decoded.data, Number(payload.new.version));
      },
    )
    .subscribe((status) => {
      if (status === 'SUBSCRIBED') onStatus?.('subscribed');
      if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT' || status === 'CLOSED') onStatus?.('unavailable');
    });
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
