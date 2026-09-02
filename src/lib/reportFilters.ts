// Phase 3: report-wide cross-filters. Unlike the two agent-editable charts'
// knobs, these apply to all six panels (including the four hand-rolled
// ones) — they subset which customers/mrr rows feed every metric, not a
// Vega spec. CAC is deliberately never filtered: it's a synthetic curve
// with no customer/segment/region breakdown to filter by (see AGENTS.md's
// data spec note).

import type { NorthbeamData, PlanTier, Region, Segment } from './types';

export type SegmentFilter = Segment | 'all';
export type RegionFilter = Region | 'all';
export type PlanFilter = PlanTier | 'all';

export interface ReportFilters {
  segment: SegmentFilter;
  region: RegionFilter;
  planTier: PlanFilter;
  accountName: string | 'all'; // drill into a single account, e.g. from clicking Top Accounts
}

export const DEFAULT_FILTERS: ReportFilters = { segment: 'all', region: 'all', planTier: 'all', accountName: 'all' };

export const SEGMENT_VALUES: SegmentFilter[] = ['all', 'SMB', 'Mid-Market', 'Enterprise'];
export const REGION_VALUES: RegionFilter[] = ['all', 'NA', 'EMEA', 'APAC', 'LATAM'];
export const PLAN_VALUES: PlanFilter[] = ['all', 'Starter', 'Team', 'Business', 'Enterprise'];

type FilterFieldOption =
  | { type: 'enum'; values: readonly string[] }
  | { type: 'string'; hint: string };

const FILTER_FIELDS: Record<keyof ReportFilters, FilterFieldOption> = {
  segment: { type: 'enum', values: SEGMENT_VALUES },
  region: { type: 'enum', values: REGION_VALUES },
  planTier: { type: 'enum', values: PLAN_VALUES },
  accountName: { type: 'string', hint: 'a customer name from get_report_context\'s topAccounts, or "all" to clear' },
};

export const FILTER_OPTIONS = FILTER_FIELDS;

export type FilterPatchResult = { ok: true } | { ok: false; reason: string; error: string };

export function validateFilterPatch(patch: unknown): FilterPatchResult {
  if (typeof patch !== 'object' || patch === null || Array.isArray(patch)) {
    return { ok: false, reason: 'invalid_patch', error: 'patch must be an object of field: value pairs.' };
  }
  const entries = Object.entries(patch as Record<string, unknown>);
  if (entries.length === 0) {
    return { ok: false, reason: 'empty_patch', error: 'patch has no fields to apply.' };
  }
  for (const [key, value] of entries) {
    const opt = FILTER_FIELDS[key as keyof typeof FILTER_FIELDS];
    if (!opt) {
      return { ok: false, reason: 'unknown_field', error: `"${key}" is not a filterable field. Editable fields: ${Object.keys(FILTER_FIELDS).join(', ')}.` };
    }
    if (typeof value !== 'string' || value.length === 0) {
      return { ok: false, reason: 'invalid_value', error: `"${key}" must be a non-empty string, got ${JSON.stringify(value)}.` };
    }
    if (opt.type === 'enum' && !opt.values.includes(value)) {
      return { ok: false, reason: 'invalid_value', error: `"${key}" must be one of ${opt.values.join(', ')}, got ${JSON.stringify(value)}.` };
    }
  }
  return { ok: true };
}

export function applyReportFilters(data: NorthbeamData, filters: ReportFilters): NorthbeamData {
  if (filters.segment === 'all' && filters.region === 'all' && filters.planTier === 'all' && filters.accountName === 'all') return data;
  const customers = data.customers.filter((c) =>
    (filters.segment === 'all' || c.segment === filters.segment) &&
    (filters.region === 'all' || c.region === filters.region) &&
    (filters.planTier === 'all' || c.planTier === filters.planTier) &&
    (filters.accountName === 'all' || c.name === filters.accountName));
  const ids = new Set(customers.map((c) => c.customerId));
  const mrrRows = data.mrrRows.filter((r) => ids.has(r.customerId));
  return { customers, mrrRows, cac: data.cac };
}
