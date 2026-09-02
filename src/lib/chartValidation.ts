import { PALETTE, BRAND } from './palette.ts';

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
  barWidth: number;
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

type FieldOption =
  | { type: 'enum'; values: readonly (string | number)[] }
  | { type: 'range'; min: number; max: number; step: number };

interface ChartOptions {
  mark: string;
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
