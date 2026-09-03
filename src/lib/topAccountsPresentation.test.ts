import { test } from 'node:test';
import assert from 'node:assert/strict';
import { topAccounts } from './metrics.ts';
import { applyReportFilters, DEFAULT_FILTERS } from './reportFilters.ts';
import { formatTopAccountArr, toggleTopAccount, topAccountsBarWidth } from './topAccountsPresentation.ts';
import type { NorthbeamData } from './types.ts';

const data: NorthbeamData = {
  customers: [
    { customerId: 'a', name: 'Alpha', segment: 'Enterprise', planTier: 'Enterprise', region: 'NA', channel: 'Paid', contractType: 'Annual', signupMonth: '2025-01', churnMonth: null },
    { customerId: 'b', name: 'Beta', segment: 'SMB', planTier: 'Starter', region: 'NA', channel: 'Organic', contractType: 'Monthly', signupMonth: '2025-01', churnMonth: null },
    { customerId: 'c', name: 'Gamma', segment: 'Enterprise', planTier: 'Enterprise', region: 'EMEA', channel: 'Paid', contractType: 'Annual', signupMonth: '2025-01', churnMonth: null },
  ],
  mrrRows: [
    { customerId: 'a', month: '2026-09', mrr: 100, isNew: false, isExpansion: false, isContraction: false, isChurned: false },
    { customerId: 'b', month: '2026-09', mrr: 500, isNew: false, isExpansion: false, isContraction: false, isChurned: false },
    { customerId: 'c', month: '2026-09', mrr: 200, isNew: false, isExpansion: false, isContraction: false, isChurned: false },
  ],
  cac: [],
};

test('bar values and widths are deterministic and safe for empty values', () => {
  assert.equal(formatTopAccountArr(12000), '$12k');
  assert.equal(topAccountsBarWidth(200, 500), 40);
  assert.equal(topAccountsBarWidth(0, 500), 0);
  assert.equal(topAccountsBarWidth(Number.NaN, 500), 0);
});

test('account selection toggles on and off', () => {
  assert.equal(toggleTopAccount('all', 'Alpha'), 'Alpha');
  assert.equal(toggleTopAccount('Alpha', 'Alpha'), 'all');
  assert.equal(toggleTopAccount('Alpha', 'Beta'), 'Beta');
});

test('stable picker ignores accountName but respects report filters', () => {
  const selected = { ...DEFAULT_FILTERS, segment: 'Enterprise' as const, accountName: 'Alpha' };
  const pickerData = applyReportFilters(data, { ...selected, accountName: 'all' });
  assert.deepEqual(topAccounts(pickerData, '2026-09', 5), [
    { name: 'Gamma', arr: 2400 },
    { name: 'Alpha', arr: 1200 },
  ]);
  assert.deepEqual(topAccounts(applyReportFilters(data, selected), '2026-09', 5), [
    { name: 'Alpha', arr: 1200 },
  ]);
});
