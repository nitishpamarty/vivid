// Covers the trust boundary agent-supplied patches cross for Product Usage,
// mirroring validation.test.ts's Revenue coverage — plus the scoping/zero-
// result behavior that keeps a filtered report from appearing to have usage
// before its createdMonth.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { UsageData } from './types.ts';
import {
  defaultUsageFilters, scopeUsageData, usageMonthList, validateUsageFilterPatch,
} from './usageFilters.ts';
import { computeUsageKpis, monthlyViewTotals, topReports } from './usageMetrics.ts';

const DATA: UsageData = {
  reports: [
    { reportId: 'r1', name: 'Pipeline Coverage', ownerTeam: 'Sales', createdMonth: '2024-01' },
    { reportId: 'r2', name: 'Renewal Risk', ownerTeam: 'Customer Success', createdMonth: '2024-03' },
  ],
  views: [
    { reportId: 'r1', month: '2024-01', views: 100, uniqueViewers: 40, engagementScore: 50 },
    { reportId: 'r1', month: '2024-02', views: 120, uniqueViewers: 45, engagementScore: 55 },
    { reportId: 'r2', month: '2024-03', views: 80, uniqueViewers: 30, engagementScore: 60 },
  ],
  activity: [{ weekday: 'Mon', hourBucket: '8-12', views: 10 }],
};

test('defaultUsageFilters resets to all/all/latest generated month', () => {
  assert.deepEqual(defaultUsageFilters(DATA), { ownerTeam: 'all', reportId: 'all', asOfMonth: '2024-03' });
});

test('validateUsageFilterPatch accepts a valid patch', () => {
  assert.equal(validateUsageFilterPatch({ ownerTeam: 'Sales' }, ['r1', 'r2'], ['2024-01']).ok, true);
});

test('validateUsageFilterPatch rejects an unknown field', () => {
  const result = validateUsageFilterPatch({ notAField: 'x' }, [], []);
  assert.equal(result.ok, false);
  assert.equal((result as { reason: string }).reason, 'unknown_field');
});

test('validateUsageFilterPatch rejects an empty patch', () => {
  const result = validateUsageFilterPatch({}, [], []);
  assert.equal(result.ok, false);
  assert.equal((result as { reason: string }).reason, 'empty_patch');
});

test('validateUsageFilterPatch rejects an unknown report id', () => {
  const result = validateUsageFilterPatch({ reportId: 'ghost' }, ['r1'], []);
  assert.equal(result.ok, false);
  assert.equal((result as { reason: string }).reason, 'invalid_value');
});

test('validateUsageFilterPatch accepts "all" for reportId without a known-id list check', () => {
  assert.equal(validateUsageFilterPatch({ reportId: 'all' }, ['r1'], []).ok, true);
});

test('validateUsageFilterPatch rejects a malformed asOfMonth', () => {
  const result = validateUsageFilterPatch({ asOfMonth: '2024-99' }, [], ['2024-01', '2024-02']);
  assert.equal(result.ok, false);
  assert.equal((result as { reason: string }).reason, 'invalid_value');
});

test('scopeUsageData filters by owner team, report, and as-of month, leaving activity untouched', () => {
  const scoped = scopeUsageData(DATA, { ownerTeam: 'Sales', reportId: 'all', asOfMonth: '2024-01' });
  assert.deepEqual(scoped.views.map((v) => v.month), ['2024-01']);
  assert.deepEqual(scoped.activity, DATA.activity);
});

test('a report never appears to have usage before its createdMonth', () => {
  const scoped = scopeUsageData(DATA, { ownerTeam: 'all', reportId: 'r2', asOfMonth: '2024-01' });
  assert.equal(scoped.views.length, 0);
  const months = usageMonthList(scoped);
  assert.deepEqual(months, []);
  assert.deepEqual(monthlyViewTotals(scoped), []);
  assert.deepEqual(topReports(scoped, '2024-01'), []);
});

test('a zero-result scope degrades to calm zeros, not NaN, and keeps the selected asOfMonth as latest', () => {
  const scoped = scopeUsageData(DATA, { ownerTeam: 'all', reportId: 'r2', asOfMonth: '2024-01' });
  const kpis = computeUsageKpis(scoped, usageMonthList(DATA), '2024-01');
  assert.equal(kpis.latest, '2024-01');
  assert.equal(kpis.views, 0);
  assert.equal(kpis.uniqueViewers, 0);
  assert.equal(kpis.engagement, 0);
  assert.equal(Number.isNaN(kpis.viewsDeltaPct), false);
  assert.equal(Number.isNaN(kpis.engagementDeltaPp), false);
});

test('the unfiltered scope preserves current Activity OS values', () => {
  const scoped = scopeUsageData(DATA, { ownerTeam: 'all', reportId: 'all', asOfMonth: '2024-03' });
  assert.deepEqual(scoped.views, DATA.views);
});
