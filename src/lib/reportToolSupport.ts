import type { Region, Segment } from './types.ts';
import type { ChartId, SwatchKey, WindowMonths } from './chartValidation.ts';

export const REPORT_ID = 'northbeam';

export const CHART_METRIC_KEYS: Record<ChartId, string> = {
  arr_bridge: 'mrr_monthly.total_mrr',
  retention_nrr: 'mrr_monthly.total_mrr',
  retention_churn: 'mrr_monthly.churned_customers',
};

const COLOR_SYNONYMS: Record<string, SwatchKey> = {
  green: 'good', good: 'good', positive: 'good',
  red: 'critical', crimson: 'critical', critical: 'critical', negative: 'critical',
  blue: 'brand', navy: 'brand', brand: 'brand',
  orange: 'cat2', amber: 'cat2', cat2: 'cat2',
  teal: 'cat3', emerald: 'cat3', cat3: 'cat3',
};
const WORD_NUMBERS: Record<string, number> = { six: 6, twelve: 12, twenty: 20, 'twenty-four': 24, one: 1, two: 2, a: 1 };
const REGION_SYNONYMS: Record<string, Region> = {
  na: 'NA', 'north america': 'NA', us: 'NA', usa: 'NA', emea: 'EMEA', europe: 'EMEA',
  apac: 'APAC', asia: 'APAC', latam: 'LATAM', 'latin america': 'LATAM',
};
const SEGMENT_SYNONYMS: Record<string, Segment> = {
  smb: 'SMB', 'small business': 'SMB', startup: 'SMB', startups: 'SMB',
  'mid-market': 'Mid-Market', midmarket: 'Mid-Market', 'mid market': 'Mid-Market', enterprise: 'Enterprise',
};

export interface FieldGuess {
  field: 'color' | 'windowMonths' | 'segment' | 'region';
  value: SwatchKey | WindowMonths | Segment | Region;
}

function nearestWindow(n: number): WindowMonths {
  const options: WindowMonths[] = [6, 12, 24];
  return options.reduce((best, w) => (Math.abs(w - n) < Math.abs(best - n) ? w : best));
}

function hasWord(haystack: string, word: string): boolean {
  return new RegExp(`\\b${word.replace(/[.*+?^${}()|[\\]\\]/g, '\\$&')}\\b`).test(haystack);
}

export function findFieldValue(phrase: string): FieldGuess {
  const p = phrase.trim().toLowerCase();
  for (const [word, region] of Object.entries(REGION_SYNONYMS)) if (hasWord(p, word)) return { field: 'region', value: region };
  for (const [word, segment] of Object.entries(SEGMENT_SYNONYMS)) if (hasWord(p, word)) return { field: 'segment', value: segment };
  for (const [word, key] of Object.entries(COLOR_SYNONYMS)) if (hasWord(p, word)) return { field: 'color', value: key };
  const digitMatch = p.match(/\d+/);
  const num = digitMatch
    ? Number(digitMatch[0])
    : Object.entries(WORD_NUMBERS).sort((a, b) => b[0].length - a[0].length).find(([word]) => hasWord(p, word))?.[1];
  if (num !== undefined) return { field: 'windowMonths', value: nearestWindow(/\byears?\b/.test(p) ? num * 12 : num) };
  return { field: 'windowMonths', value: 12 };
}
