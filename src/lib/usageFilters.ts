// Product Usage's own state/filter contract — deliberately separate from
// Revenue's ReportFilters (reportFilters.ts) so Usage-only fields never leak
// into the Revenue tool contract, and vice versa. Same validation/`{ ok,
// reason, error }` discipline as reportFilters.ts, applied to Usage's own
// fields (ownerTeam, reportId, asOfMonth).

import type { Department, UsageData } from './types.ts';

export type OwnerTeamFilter = Department | 'all';

export interface UsageFilters {
  ownerTeam: OwnerTeamFilter;
  reportId: string | 'all';
  asOfMonth: string;
}

export interface UsageDashboardState {
  filters: UsageFilters;
}

export const OWNER_TEAM_VALUES: OwnerTeamFilter[] = [
  'all', 'Engineering', 'Sales', 'Customer Success', 'Marketing', 'Product', 'People', 'Finance',
];

export function usageMonthList(data: UsageData): string[] {
  return [...new Set(data.views.map((r) => r.month))].sort();
}

export function defaultUsageFilters(data: UsageData): UsageFilters {
  const months = usageMonthList(data);
  return { ownerTeam: 'all', reportId: 'all', asOfMonth: months[months.length - 1] ?? '' };
}

export function defaultUsageDashboardState(data: UsageData): UsageDashboardState {
  return { filters: defaultUsageFilters(data) };
}

export function usageReportOptions(data: UsageData) {
  return [...data.reports].sort((a, b) => a.name.localeCompare(b.name));
}

type UsageFilterFieldOption =
  | { type: 'enum'; values: readonly string[] }
  | { type: 'string'; hint: string };

const USAGE_FILTER_FIELDS: Record<keyof UsageFilters, UsageFilterFieldOption> = {
  ownerTeam: { type: 'enum', values: OWNER_TEAM_VALUES },
  reportId: { type: 'string', hint: 'an exact known report id from find_usage_values or list_usage_options, or "all" to clear' },
  asOfMonth: { type: 'string', hint: 'a generated month (YYYY-MM) from list_usage_options' },
};

export const USAGE_FILTER_OPTIONS = USAGE_FILTER_FIELDS;

export type UsageFilterPatchResult = { ok: true } | { ok: false; reason: string; error: string };

export function validateUsageFilterPatch(patch: unknown, validReportIds: readonly string[], validMonths: readonly string[]): UsageFilterPatchResult {
  if (typeof patch !== 'object' || patch === null || Array.isArray(patch)) {
    return { ok: false, reason: 'invalid_patch', error: 'patch must be an object of field: value pairs.' };
  }
  const entries = Object.entries(patch as Record<string, unknown>);
  if (entries.length === 0) {
    return { ok: false, reason: 'empty_patch', error: 'patch has no fields to apply.' };
  }
  for (const [key, value] of entries) {
    const opt = USAGE_FILTER_FIELDS[key as keyof typeof USAGE_FILTER_FIELDS];
    if (!opt) {
      return { ok: false, reason: 'unknown_field', error: `"${key}" is not a filterable field. Editable fields: ${Object.keys(USAGE_FILTER_FIELDS).join(', ')}.` };
    }
    if (typeof value !== 'string' || value.length === 0) {
      return { ok: false, reason: 'invalid_value', error: `"${key}" must be a non-empty string, got ${JSON.stringify(value)}.` };
    }
    if (opt.type === 'enum' && !opt.values.includes(value)) {
      return { ok: false, reason: 'invalid_value', error: `"${key}" must be one of ${opt.values.join(', ')}, got ${JSON.stringify(value)}.` };
    }
    if (key === 'reportId' && value !== 'all' && !validReportIds.includes(value)) {
      return { ok: false, reason: 'invalid_value', error: `"${value}" is not a known report id. Use "all" or an exact id from find_usage_values.` };
    }
    if (key === 'asOfMonth' && !validMonths.includes(value)) {
      return { ok: false, reason: 'invalid_value', error: `"asOfMonth" must be one of the generated months, got ${JSON.stringify(value)}.` };
    }
  }
  return { ok: true };
}

// Scopes view rows by owner team, report, and as-of month. `reports` and
// `activity` pass through unchanged — `activity` is a global typical-week
// aggregate, deliberately never subset by these filters (see AGENTS.md).
export function scopeUsageData(data: UsageData, filters: UsageFilters): UsageData {
  const teamByReport = new Map(data.reports.map((r) => [r.reportId, r.ownerTeam]));
  const views = data.views.filter((v) =>
    (filters.ownerTeam === 'all' || teamByReport.get(v.reportId) === filters.ownerTeam) &&
    (filters.reportId === 'all' || v.reportId === filters.reportId) &&
    v.month <= filters.asOfMonth);
  return { reports: data.reports, views, activity: data.activity };
}

export const USAGE_REPORT_ID = 'product_usage';
export const USAGE_SCHEMA_VERSION = 1;

// ---- find_usage_values: phrase -> canonical team/report id, best guess ----

export interface UsageFieldGuess {
  field: 'ownerTeam' | 'reportId';
  value: string;
}

export function findUsageValue(phrase: string, data: UsageData): UsageFieldGuess | null {
  const p = phrase.trim().toLowerCase();
  if (!p) return null;
  for (const team of OWNER_TEAM_VALUES) {
    if (team !== 'all' && p.includes(team.toLowerCase())) return { field: 'ownerTeam', value: team };
  }
  const report = data.reports.find((r) => r.name.toLowerCase().includes(p) || p.includes(r.name.toLowerCase()));
  if (report) return { field: 'reportId', value: report.reportId };
  return null;
}
